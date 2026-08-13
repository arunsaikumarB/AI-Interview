"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Circle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type CheckStatus = "pending" | "checking" | "ready" | "failed" | "skipped";

type Row = {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string | null;
  required: boolean;
};

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "checking") {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />;
  }
  if (status === "ready") {
    return <Check className="size-4 text-success" aria-hidden />;
  }
  if (status === "failed") {
    return <X className="size-4 text-destructive" aria-hidden />;
  }
  if (status === "skipped") {
    return <Circle className="size-3.5 text-muted-foreground" aria-hidden />;
  }
  return <Circle className="size-3.5 text-muted-foreground" aria-hidden />;
}

function statusLabel(status: CheckStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "failed":
      return "Needs attention";
    case "checking":
      return "Checking…";
    case "skipped":
      return "Skipped";
    default:
      return "Not checked";
  }
}

function checkBrowser(): { ok: boolean; detail: string } {
  if (typeof window === "undefined") {
    return { ok: false, detail: "Browser APIs unavailable" };
  }
  const secure =
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!secure) {
    return {
      ok: false,
      detail: "This interview needs a secure (HTTPS) browser connection.",
    };
  }
  try {
    sessionStorage.setItem("aros-syscheck-probe", "1");
    sessionStorage.removeItem("aros-syscheck-probe");
  } catch {
    return {
      ok: false,
      detail: "Your browser is blocking session storage required for the interview.",
    };
  }
  return { ok: true, detail: "Browser looks compatible" };
}

/**
 * Pre-interview readiness screen.
 * TEXT: browser only. VOICE: mic + speaker + browser.
 * Camera only when proctoring is enabled — optional (never blocks continue).
 */
export function PreInterviewSystemCheck({
  mode,
  proctoringEnabled,
  onContinue,
  onUseText,
}: {
  mode: "TEXT" | "VOICE";
  proctoringEnabled: boolean;
  onContinue: () => void;
  /** Voice interviews may fall back to typing. */
  onUseText?: () => void;
}) {
  const isVoice = mode === "VOICE";
  const showCamera = isVoice && proctoringEnabled;

  const [browser, setBrowser] = useState<CheckStatus>("pending");
  const [browserDetail, setBrowserDetail] = useState<string | null>(null);
  const [microphone, setMicrophone] = useState<CheckStatus>("pending");
  const [micDetail, setMicDetail] = useState<string | null>(null);
  const [speaker, setSpeaker] = useState<CheckStatus>("pending");
  const [speakerDetail, setSpeakerDetail] = useState<string | null>(null);
  const [camera, setCamera] = useState<CheckStatus>("pending");
  const [cameraDetail, setCameraDetail] = useState<string | null>(null);

  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [testUrl, setTestUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const result = checkBrowser();
    setBrowser(result.ok ? "ready" : "failed");
    setBrowserDetail(result.detail);
  }, []);

  useEffect(() => {
    if (!isVoice) return;
    let cancelled = false;
    (async () => {
      setMicrophone("checking");
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophone("failed");
        setMicDetail("This browser does not support microphone access.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setMicrophone("pending");
        setMicDetail("Microphone permission granted — run a short test.");
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setLevel(Math.min(1, avg / 80));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setMicrophone("failed");
        setMicDetail(
          "Microphone permission is required for voice interviews. Allow access and reload, or use text instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    };
  }, [isVoice]);

  async function runMicTest() {
    if (!streamRef.current) return;
    setError(null);
    setTestUrl(null);
    setMicrophone("checking");
    chunksRef.current = [];
    const rec = new MediaRecorder(streamRef.current, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      setTestUrl(URL.createObjectURL(blob));
      if (blob.size > 500) {
        setMicrophone("ready");
        setMicDetail("Microphone test passed");
      } else {
        setMicrophone("failed");
        setMicDetail("Recording too quiet — try again closer to the mic");
      }
      setRecording(false);
      setCountdown(0);
    };
    rec.start();
    setRecording(true);
    for (let i = 3; i > 0; i--) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  function playTestSound() {
    setError(null);
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
      setSpeakerDetail("Did you hear the tone? Confirm below.");
      if (speaker !== "ready") setSpeaker("pending");
    } catch {
      setSpeaker("failed");
      setSpeakerDetail("Could not play audio. Check device volume and try again.");
    }
  }

  function confirmSpeaker() {
    setSpeaker("ready");
    setSpeakerDetail("Speaker confirmed");
  }

  async function checkCamera() {
    setCamera("checking");
    setCameraDetail(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = stream;
      // Immediate stop — we only verify access; consent still decides later.
      stream.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
      setCamera("ready");
      setCameraDetail("Camera available (optional for proctoring)");
    } catch {
      setCamera("failed");
      setCameraDetail(
        "Camera not available. You can skip — camera is optional for this interview.",
      );
    }
  }

  function skipCamera() {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    setCamera("skipped");
    setCameraDetail("Skipped — you can continue without camera");
  }

  const rows: Row[] = useMemo(() => {
    const list: Row[] = [
      {
        id: "browser",
        label: "Browser",
        status: browser,
        detail: browserDetail,
        required: true,
      },
    ];
    if (isVoice) {
      list.push(
        {
          id: "microphone",
          label: "Microphone",
          status: microphone,
          detail: micDetail,
          required: true,
        },
        {
          id: "speaker",
          label: "Speaker",
          status: speaker,
          detail: speakerDetail,
          required: true,
        },
      );
    }
    if (showCamera) {
      list.push({
        id: "camera",
        label: "Camera",
        status: camera,
        detail: cameraDetail,
        required: false,
      });
    }
    return list;
  }, [
    browser,
    browserDetail,
    isVoice,
    microphone,
    micDetail,
    speaker,
    speakerDetail,
    showCamera,
    camera,
    cameraDetail,
  ]);

  const requiredOk = rows
    .filter((r) => r.required)
    .every((r) => r.status === "ready");

  const cameraOk =
    !showCamera ||
    camera === "ready" ||
    camera === "skipped" ||
    camera === "failed";

  const canContinue = requiredOk && cameraOk;

  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-2xl border border-border bg-card p-8 shadow-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Logisoft HireOS
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Before you begin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Let&apos;s quickly check your device so your interview can run smoothly.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {isVoice
            ? "Voice interview — microphone and speaker are required."
            : "Text interview — no microphone or camera needed."}
        </p>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-start justify-between gap-3 px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {row.label}
                {!row.required ? (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (optional)
                  </span>
                ) : null}
              </p>
              {row.detail ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
              ) : null}
            </div>
            <div
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-xs font-medium",
                row.status === "ready" && "text-success",
                row.status === "failed" && "text-destructive",
                row.status === "pending" && "text-muted-foreground",
                row.status === "skipped" && "text-muted-foreground",
                row.status === "checking" && "text-muted-foreground",
              )}
            >
              <StatusIcon status={row.status} />
              {statusLabel(row.status)}
            </div>
          </li>
        ))}
      </ul>

      {isVoice ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Microphone level</p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-ai transition-[width]"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={playTestSound}
            >
              Play test sound
            </Button>
            {speaker !== "ready" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={confirmSpeaker}
              >
                I can hear it
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={runMicTest}
              disabled={recording || !streamRef.current}
            >
              {recording ? `Recording… ${countdown}s` : "Record 3s mic test"}
            </Button>
          </div>
          {testUrl ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Playback your test recording</p>
              <audio src={testUrl} controls className="w-full" />
            </div>
          ) : null}
        </div>
      ) : null}

      {showCamera ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={checkCamera}
            disabled={camera === "checking"}
          >
            Check camera
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={skipCamera}
            disabled={camera === "checking"}
          >
            Skip camera
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button
        className="w-full"
        disabled={!canContinue}
        onClick={onContinue}
      >
        Continue
      </Button>

      {isVoice && onUseText ? (
        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground underline"
          onClick={onUseText}
        >
          Use text instead
        </button>
      ) : null}
    </div>
  );
}
