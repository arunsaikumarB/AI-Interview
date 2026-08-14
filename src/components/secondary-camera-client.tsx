"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import {
  IntegrityTerminatedScreen,
  IntegrityWarningDialog,
} from "@/components/integrity-ui";
import {
  CHUNK_TIMESLICE_MS,
  MAX_PENDING_CLIENT_CHUNKS,
  RECORDING_AUDIO_BITRATE,
  RECORDING_VIDEO_BITRATE,
  capSecondaryCameraTo1080p,
  secondaryCameraVideoConstraints,
} from "@/lib/secondary-recording-client";
import { createSecondaryIntegrityMonitor } from "@/lib/secondary-integrity-client";
import type { SecondaryFramingStatus } from "@/lib/secondary-integrity-client";
import { candidateSecondaryFixMessage } from "@/lib/integrity";
import type { SecondaryIntegrityKind } from "@/lib/integrity";
import { createOrientedRecordStream, cameraBufferNeedsPortraitRotate } from "@/lib/secondary-record-orientation";

type Meta = {
  jobTitle: string;
  candidateFirstName: string;
  status: string;
  label?: string;
  message: string;
  interviewStatus?: string;
  placementConfirmed?: boolean;
  shouldRecord?: boolean;
  recordingStatus?: string;
  recordingId?: string | null;
  pendingIntegrityWarning?: {
    kind: SecondaryIntegrityKind;
    warningNumber: number;
    warningOf: number;
    message: string;
  } | null;
};

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const isiOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  const candidates = isiOS
    ? [
        "video/mp4",
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ]
    : [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp9",
        "video/webm",
        "video/mp4",
      ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function createMediaRecorder(
  stream: MediaStream,
  mime?: string,
): MediaRecorder {
  const withBitrate: MediaRecorderOptions = {
    videoBitsPerSecond: RECORDING_VIDEO_BITRATE,
    audioBitsPerSecond: RECORDING_AUDIO_BITRATE,
  };
  if (mime) withBitrate.mimeType = mime;
  try {
    return new MediaRecorder(stream, withBitrate);
  } catch {
    return mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
  }
}

async function openCameraAndMic(): Promise<MediaStream> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: secondaryCameraVideoConstraints(),
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    await capSecondaryCameraTo1080p(stream);
    return stream;
  } catch {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    await capSecondaryCameraTo1080p(stream);
    return stream;
  }
}

/**
 * Secondary device — live preview frames + chunked video/audio recording.
 * Recording starts only after interview start + placement + consent (server).
 */
export function SecondaryCameraClient({ code }: { code: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [uiState, setUiState] = useState("Ready to pair");
  const [recLabel, setRecLabel] = useState<string | null>(null);
  const [phoneTerminated, setPhoneTerminated] = useState(false);
  const [integrityWarning, setIntegrityWarning] = useState<{
    warningNumber: number;
    warningOf: number;
    message: string;
  } | null>(null);
  const [orientHint, setOrientHint] = useState<string | null>(null);
  const [framing, setFraming] = useState<SecondaryFramingStatus | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairedRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const orientedStopRef = useRef<(() => void) | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const chunkIndexRef = useRef(0);
  const pendingQueue = useRef<{ index: number; blob: Blob; mime: string }[]>(
    [],
  );
  const uploadingRef = useRef(false);
  const interruptedAtRef = useRef<number | null>(null);
  const recordingActiveRef = useRef(false);
  const warningOpenRef = useRef(false);
  const framingRef = useRef<SecondaryFramingStatus | null>(null);
  const emitEventsRef = useRef(false);
  const monitorRef = useRef<ReturnType<
    typeof createSecondaryIntegrityMonitor
  > | null>(null);
  const requestDataTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  warningOpenRef.current = Boolean(integrityWarning);
  emitEventsRef.current = Boolean(
    meta?.placementConfirmed && meta.interviewStatus === "IN_PROGRESS",
  );

  const stopStreamingOnly = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (hbRef.current) clearInterval(hbRef.current);
    hbRef.current = null;
    setStreaming(false);
  }, []);

  const flushQueue = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      while (pendingQueue.current.length > 0 && recordingIdRef.current) {
        const item = pendingQueue.current[0];
        const form = new FormData();
        form.append("chunk", item.blob, `chunk-${item.index}.part`);
        form.append("recordingId", recordingIdRef.current);
        form.append("chunkIndex", String(item.index));
        form.append("mime", item.mime);
        try {
          const res = await fetch(
            `/api/interview/secondary/${code}/recording/chunk`,
            { method: "POST", body: form },
          );
          if (res.status === 429) break;
          if (res.status === 410) {
            pendingQueue.current = [];
            break;
          }
          if (!res.ok) break;
          pendingQueue.current.shift();
        } catch {
          setRecLabel("Secondary recording interrupted. Reconnecting…");
          break;
        }
      }
    } finally {
      uploadingRef.current = false;
    }
  }, [code]);

  const stopRecorder = useCallback(async (finalize: boolean) => {
    recordingActiveRef.current = false;
    orientedStopRef.current?.();
    orientedStopRef.current = null;
    if (requestDataTimerRef.current) {
      clearInterval(requestDataTimerRef.current);
      requestDataTimerRef.current = null;
    }
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        try {
          rec.stop();
        } catch {
          resolve();
        }
      });
    }
    await flushQueue();
    if (finalize) {
      try {
        await fetch(`/api/interview/secondary/${code}/recording/finalize`, {
          method: "POST",
        });
        setRecLabel("Secondary recording saved");
      } catch {
        setRecLabel("Secondary recording interrupted");
      }
    }
  }, [code, flushQueue]);

  const startRecorder = useCallback(async () => {
    if (recordingActiveRef.current || !streamRef.current) return;
    const startRes = await fetch(
      `/api/interview/secondary/${code}/recording/start`,
      { method: "POST" },
    );
    const startData = await startRes.json().catch(() => ({}));
    if (!startRes.ok) {
      setRecLabel(startData.error ?? "Waiting to record…");
      return;
    }
    recordingIdRef.current = startData.recordingId as string;
    chunkIndexRef.current = 0;
    pendingQueue.current = [];
    if (typeof MediaRecorder === "undefined") {
      setRecLabel("Secondary recording is not supported by this browser.");
      return;
    }
    const mime = pickRecorderMime();
    let rec: MediaRecorder;
    const videoEl = videoRef.current;
    const oriented =
      videoEl && streamRef.current
        ? createOrientedRecordStream(videoEl, streamRef.current)
        : null;
    orientedStopRef.current = oriented?.stop ?? null;
    const recordStream = oriented?.stream ?? streamRef.current;
    try {
      rec = createMediaRecorder(recordStream, mime);
    } catch {
      orientedStopRef.current?.();
      orientedStopRef.current = null;
      try {
        rec = createMediaRecorder(streamRef.current, mime);
      } catch {
        setRecLabel("Secondary recording is not supported by this browser.");
        return;
      }
    }
    const usedMime = rec.mimeType || mime || "video/webm";
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const index = chunkIndexRef.current;
      chunkIndexRef.current += 1;
      if (pendingQueue.current.length >= MAX_PENDING_CLIENT_CHUNKS) {
        pendingQueue.current.shift();
        setRecLabel("Secondary recording interrupted");
        void fetch(`/api/interview/secondary/${code}/recording/interrupt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gapMs: CHUNK_TIMESLICE_MS }),
        });
      }
      pendingQueue.current.push({ index, blob: e.data, mime: usedMime });
      void flushQueue();
    };
    rec.onerror = () => {
      setRecLabel("Secondary recording interrupted");
      void fetch(`/api/interview/secondary/${code}/recording/interrupt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gapMs: 0 }),
      });
    };
    recorderRef.current = rec;
    recordingActiveRef.current = true;
    interruptedAtRef.current = null;
    rec.start(CHUNK_TIMESLICE_MS);
    if (requestDataTimerRef.current) clearInterval(requestDataTimerRef.current);
    requestDataTimerRef.current = setInterval(() => {
      if (recorderRef.current?.state === "recording") {
        try {
          recorderRef.current.requestData();
        } catch {
          /* some browsers only emit on stop */
        }
      }
    }, 2000);
    setRecLabel("Secondary camera recording");
  }, [code, flushQueue]);

  const stopAll = useCallback(
    async (notify = true) => {
      await stopRecorder(true);
      stopStreamingOnly();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCamReady(false);
      if (notify && pairedRef.current) {
        try {
          await fetch(`/api/interview/secondary/${code}/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ disconnect: true }),
          });
        } catch {
          /* ignore */
        }
      }
      pairedRef.current = false;
      setConnected(false);
      setUiState("Secondary camera disconnected");
    },
    [code, stopRecorder, stopStreamingOnly],
  );

  const startStreaming = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !streamRef.current) return;
    stopStreamingOnly();
    setStreaming(true);
    setUiState("Secondary camera connected");

    const pushFrame = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) return;
      const maxW = 640;
      const scale = Math.min(1, maxW / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.55),
      );
      if (!blob) return;
      const form = new FormData();
      form.append("frame", blob, "frame.jpg");
      const snap = framingRef.current;
      if (snap) form.append("framing", JSON.stringify(snap));
      try {
        const res = await fetch(`/api/interview/secondary/${code}/frame`, {
          method: "POST",
          body: form,
        });
        if (res.status === 410) {
          setPhoneTerminated(true);
          setUiState("Interview ended");
          void stopAll(false);
        }
      } catch {
        setUiState("Reconnecting secondary camera…");
      }
    };

    void pushFrame();
    timerRef.current = setInterval(() => void pushFrame(), 700);
    hbRef.current = setInterval(() => {
      void fetch(`/api/interview/secondary/${code}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then(async (res) => {
        if (res.status === 410) {
          setPhoneTerminated(true);
          setUiState("Interview ended");
          void stopAll(false);
        }
      });
    }, 5000);
  }, [code, stopAll, stopStreamingOnly]);

  const attachStream = useCallback(
    async (stream: MediaStream) => {
      streamRef.current = stream;
      stream.getTracks().forEach((t) => {
        t.addEventListener("ended", () => {
          setUiState("Secondary camera connection interrupted");
          setRecLabel("Secondary recording interrupted. Reconnecting…");
          setCamReady(false);
          stopStreamingOnly();
          if (recordingActiveRef.current) {
            interruptedAtRef.current = Date.now();
            void fetch(`/api/interview/secondary/${code}/recording/interrupt`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ gapMs: 0 }),
            });
          }
        });
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCamReady(true);
      if (pairedRef.current) startStreaming();
    },
    [code, startStreaming, stopStreamingOnly],
  );

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/interview/secondary/${code}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Secondary camera connection unavailable.");
        return;
      }
      setMeta(data);
    })();
    return () => {
      void stopAll(true);
    };
  }, [code, stopAll]);

  // Poll for shouldRecord / interview start
  useEffect(() => {
    if (!connected) return;
    const tick = async () => {
      try {
        const res = await fetch(`/api/interview/secondary/${code}`);
        const data = (await res.json()) as Meta;
        if (!res.ok) {
          if (res.status === 410) {
            setPhoneTerminated(true);
            setUiState("Interview ended");
            await stopRecorder(true);
          }
          return;
        }
        setMeta(data);
        if (data.pendingIntegrityWarning) {
          setIntegrityWarning({
            warningNumber: data.pendingIntegrityWarning.warningNumber,
            warningOf: data.pendingIntegrityWarning.warningOf,
            message: data.pendingIntegrityWarning.message,
          });
        } else if (warningOpenRef.current) {
          setIntegrityWarning(null);
          monitorRef.current?.resume();
        }
        if (data.shouldRecord && !recordingActiveRef.current) {
          await startRecorder();
        }
        if (
          !data.shouldRecord &&
          recordingActiveRef.current &&
          (data.interviewStatus === "COMPLETED" ||
            data.interviewStatus === "TERMINATED" ||
            data.recordingStatus === "FINALIZING")
        ) {
          await stopRecorder(true);
        }
      } catch {
        /* network blip */
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [code, connected, startRecorder, stopRecorder]);

  useEffect(() => {
    if (phoneTerminated || !connected || !camReady || !videoRef.current) {
      return;
    }
    const monitor = createSecondaryIntegrityMonitor({
      code,
      video: videoRef.current,
      isPaused: () => warningOpenRef.current,
      emitEvents: () => emitEventsRef.current,
      onFraming: (status) => {
        framingRef.current = status;
        setFraming(status);
      },
      onResult: (result) => {
        if (result.terminated) {
          setPhoneTerminated(true);
          setIntegrityWarning(null);
          void stopAll(false);
          return;
        }
        if (result.showWarning && result.kind) {
          const n = result.warningNumber ?? 1;
          const of = result.warningOf ?? 3;
          const base = candidateSecondaryFixMessage(result.kind);
          setIntegrityWarning({
            warningNumber: n,
            warningOf: of,
            message:
              n >= of
                ? `${base} Your interview may be paused for recruiter review if this continues.`
                : n >= 2
                  ? `Integrity warning: unusual activity detected. ${base}`
                  : base,
          });
        }
      },
    });
    monitorRef.current = monitor;
    void monitor.start();
    return () => {
      monitor.stop();
      monitorRef.current = null;
    };
  }, [
    phoneTerminated,
    connected,
    camReady,
    code,
    stopAll,
  ]);

  useEffect(() => {
    if (!camReady) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.videoWidth < 8) return;
      if (cameraBufferNeedsPortraitRotate(v)) {
        setOrientHint(
          "Rotate your phone so the preview matches the room. Rest it on its side for a landscape view of you and the desk.",
        );
      } else {
        setOrientHint(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [camReady]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") {
        setUiState("Secondary camera connection interrupted");
        if (recordingActiveRef.current) {
          interruptedAtRef.current = Date.now();
          setRecLabel("Secondary recording interrupted. Reconnecting…");
          void fetch(`/api/interview/secondary/${code}/recording/interrupt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gapMs: 0 }),
          });
        }
        return;
      }
      if (!pairedRef.current) return;
      void (async () => {
        try {
          if (
            !streamRef.current ||
            streamRef.current.getTracks().every((t) => t.readyState === "ended")
          ) {
            setUiState("Reconnecting secondary camera…");
            const stream = await openCameraAndMic();
            await attachStream(stream);
            const res = await fetch(`/api/interview/secondary/${code}/connect`, {
              method: "POST",
            });
            if (res.ok) {
              setConnected(true);
              startStreaming();
              if (interruptedAtRef.current) {
                const gap = Date.now() - interruptedAtRef.current;
                interruptedAtRef.current = null;
                void fetch(
                  `/api/interview/secondary/${code}/recording/interrupt`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ gapMs: gap }),
                  },
                );
              }
              setRecLabel("Secondary recording resumed");
              await startRecorder();
            }
          } else if (pairedRef.current && !streaming) {
            startStreaming();
          }
        } catch {
          setUiState("Secondary camera connection interrupted");
        }
      })();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [attachStream, code, startRecorder, startStreaming, streaming]);

  async function enableCamera() {
    setError(null);
    setUiState("Connecting secondary camera…");
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError(
        "Camera and microphone need HTTPS on phones. Re-scan the HTTPS QR, accept the certificate once, then Allow.",
      );
      setUiState("Secondary camera disconnected");
      return;
    }
    try {
      const stream = await openCameraAndMic();
      await attachStream(stream);
      setUiState("Camera + microphone ready — pair with the interview");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          "Camera and microphone permission required. Tap Allow, then choose Allow in the browser prompt.",
        );
      } else {
        setError("Could not access camera/microphone on this device.");
      }
      setUiState("Secondary camera disconnected");
    }
  }

  async function pairWithSession() {
    setError(null);
    setUiState("Connecting secondary camera…");
    const res = await fetch(`/api/interview/secondary/${code}/connect`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not pair with interview");
      setUiState("Secondary camera disconnected");
      return;
    }
    pairedRef.current = true;
    setConnected(true);
    startStreaming();
  }

  if (error && !meta) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
        <div className="mb-3 text-foreground">
          <BrandLogo size="header" />
        </div>
        <p className="font-medium">Secondary camera connection unavailable.</p>
        <p className="mt-2 text-sm">{error}</p>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-6 text-center">
        <BrandLogo size="header" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (phoneTerminated) {
    return <IntegrityTerminatedScreen />;
  }

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <IntegrityWarningDialog
        open={Boolean(integrityWarning)}
        warningNumber={integrityWarning?.warningNumber ?? 1}
        warningOf={integrityWarning?.warningOf ?? 3}
        message={
          integrityWarning?.message ??
          "Please correct the side-camera issue, then tap I’ve fixed this."
        }
        stayHint="Please remain focused on the interview. Return to your normal position, then continue."
        onDismiss={() => {
          void fetch(`/api/interview/secondary/${code}/integrity/ack`, {
            method: "POST",
          });
          setIntegrityWarning(null);
          monitorRef.current?.resume();
        }}
      />
      <div>
        <BrandLogo size="header" />
        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
          Secondary camera
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Pair with interview
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {meta.candidateFirstName} · {meta.jobTitle}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{meta.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Keep the phone still and stay in a quiet room alone. Look only at the
          interview laptop — looking at this phone ends the interview.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        <span
          className={cn(
            "status-dot",
            uiState.toLowerCase().includes("reconnect")
              ? "status-dot-reconnecting"
              : connected && streaming
                ? "status-dot-connected"
                : uiState.toLowerCase().includes("connecting")
                  ? "status-dot-connecting"
                  : uiState.toLowerCase().includes("interrupt") ||
                      uiState.toLowerCase().includes("disconnect")
                    ? "status-dot-disconnected"
                    : connected
                      ? "status-dot-connected"
                      : "status-dot-connecting",
          )}
          aria-hidden
        />
        {uiState}
      </div>
      {recLabel ? (
        <div className="rounded-lg border border-ai/30 bg-ai/10 px-3 py-2 text-sm text-ai">
          {recLabel}
        </div>
      ) : null}

      {orientHint ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          Rotate your phone. {orientHint}
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-xl border border-border bg-background">
        <video
          ref={videoRef}
          playsInline
          muted
          className="max-h-[70vh] w-full object-contain"
        />
        {camReady ? (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 text-[10px] font-medium uppercase tracking-[0.12em] text-foreground/80"
            aria-hidden
          >
            <div className="rounded-md border border-dashed border-primary/35 bg-background/20 px-2 py-1 text-center">
              Surrounding area
            </div>
            <div className="mx-auto w-[55%] rounded-lg border border-primary/50 bg-background/15 px-2 py-6 text-center">
              Candidate visible
            </div>
            <div className="rounded-md border border-dashed border-primary/35 bg-background/20 px-2 py-1 text-center">
              Laptop visible
            </div>
          </div>
        ) : null}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {connected && camReady ? (
        <div className="space-y-2 rounded-lg border border-border px-3 py-2 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Expected view
          </p>
          <ul className="space-y-1 text-foreground">
            <li>
              {framing?.candidateVisible
                ? "✓ Candidate visible"
                : "○ Candidate visible"}
            </li>
            <li>
              {framing?.laptopVisible ? "✓ Laptop visible" : "○ Laptop visible"}
            </li>
            <li>
              {framing?.extraPersonInPrimaryZone
                ? "⚠ Additional person detected"
                : "✓ No additional person detected"}
            </li>
          </ul>
          {framing?.extraPersonInPrimaryZone ? (
            <p className="text-sm text-warning">
              Please make sure only the candidate is in the interview area
              before continuing.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => monitorRef.current?.resume()}
          >
            Recheck camera
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="space-y-2">
        {!camReady ? (
          <Button className="w-full" onClick={enableCamera}>
            Allow camera & microphone
          </Button>
        ) : !connected ? (
          <Button className="w-full" onClick={pairWithSession}>
            Pair with interview session
          </Button>
        ) : (
          <div className="rounded-lg border border-ai/30 bg-ai/10 px-3 py-2 text-sm text-foreground">
            <span className="font-medium text-ai">Camera connected</span>
            {streaming ? " · Live preview sending" : ""}
            {meta.placementConfirmed
              ? " · Placement confirmed — recording starts when the interview begins"
              : " · Waiting for host placement confirmation"}
          </div>
        )}

        {connected ? (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => void stopAll(true)}
          >
            Disconnect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
