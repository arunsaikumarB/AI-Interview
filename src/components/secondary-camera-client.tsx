"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Meta = {
  jobTitle: string;
  candidateFirstName: string;
  status: string;
  label?: string;
  message: string;
};

async function openCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch {
    // facingMode may be unsupported — fall back to any camera.
    return navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
  }
}

/**
 * Secondary device page — local preview + ephemeral frames to host.
 * Handles background/lock via visibility + track ended → reconnect.
 */
export function SecondaryCameraClient({ code }: { code: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [uiState, setUiState] = useState("Ready to pair");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pairedRef = useRef(false);

  const stopStreamingOnly = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (hbRef.current) clearInterval(hbRef.current);
    hbRef.current = null;
    setStreaming(false);
  }, []);

  const stopAll = useCallback(
    async (notify = true) => {
      stopStreamingOnly();
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
    [code, stopStreamingOnly],
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
      // Preserve aspect ratio (portrait or landscape).
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
      try {
        const res = await fetch(`/api/interview/secondary/${code}/frame`, {
          method: "POST",
          body: form,
        });
        if (res.status === 410) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Pairing expired");
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
          setUiState("Interview ended");
          void stopAll(false);
        }
      });
    }, 5000);
  }, [code, stopAll, stopStreamingOnly]);

  const attachStream = useCallback(
    async (stream: MediaStream) => {
      streamRef.current = stream;
      stream.getVideoTracks().forEach((t) => {
        t.addEventListener("ended", () => {
          setUiState("Secondary camera connection interrupted");
          setCamReady(false);
          stopStreamingOnly();
        });
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCamReady(true);
      if (pairedRef.current) startStreaming();
    },
    [startStreaming, stopStreamingOnly],
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

  // Mobile lifecycle: resume camera when tab becomes visible again.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") {
        setUiState("Secondary camera connection interrupted");
        return;
      }
      if (!pairedRef.current) return;
      void (async () => {
        try {
          if (!streamRef.current || streamRef.current.getTracks().every((t) => t.readyState === "ended")) {
            setUiState("Reconnecting secondary camera…");
            const stream = await openCamera();
            await attachStream(stream);
            const res = await fetch(`/api/interview/secondary/${code}/connect`, {
              method: "POST",
            });
            if (res.ok) {
              setConnected(true);
              startStreaming();
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
  }, [attachStream, code, startStreaming, streaming]);

  async function enableCamera() {
    setError(null);
    setUiState("Connecting secondary camera…");
    try {
      const stream = await openCamera();
      await attachStream(stream);
      setUiState("Camera ready — pair with the interview");
    } catch {
      setError(
        "Camera permission is required on this device. Allow access and try again.",
      );
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
      <div className="mx-auto max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
        <p className="font-medium">Secondary camera connection unavailable.</p>
        <p className="mt-2 text-sm">{error}</p>
      </div>
    );
  }

  if (!meta) {
    return <p className="text-center text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">
          Secondary camera
        </p>
        <h1 className="mt-1 font-display text-2xl text-slate-900">
          Pair with interview
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {meta.candidateFirstName} · {meta.jobTitle}
        </p>
        <p className="mt-2 text-xs text-slate-500">{meta.message}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
        {uiState}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
        <video
          ref={videoRef}
          playsInline
          muted
          className="max-h-[70vh] w-full object-contain"
        />
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="space-y-2">
        {!camReady ? (
          <Button className="w-full" onClick={enableCamera}>
            Allow camera
          </Button>
        ) : !connected ? (
          <Button className="w-full" onClick={pairWithSession}>
            Pair with interview session
          </Button>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Secondary camera connected
            {streaming ? " · Live preview sending" : ""}
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

      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
        <li>Keep this page open during the interview.</li>
        <li>Keep your phone connected to power if possible.</li>
        <li>Keep the screen on.</li>
      </ul>
    </div>
  );
}
