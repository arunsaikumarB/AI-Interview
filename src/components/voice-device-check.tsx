"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Mic permission + level meter + 3s test record/playback + speaker test.
 * Continue disabled until mic test passes. Camera not required.
 */
export function VoiceDeviceCheck({
  onContinue,
  onUseText,
}: {
  onContinue: () => void;
  onUseText: () => void;
}) {
  const [micOk, setMicOk] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState(false);
  const [testUrl, setTestUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setMicReady(true);
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
        setError("Microphone permission is required for voice interviews.");
        setMicReady(false);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function runMicTest() {
    if (!streamRef.current) return;
    setError(null);
    setTestUrl(null);
    setMicOk(false);
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
      setMicOk(blob.size > 500);
      setRecording(false);
      setCountdown(0);
    };
    rec.start();
    setRecording(true);
    setCountdown(3);
    for (let i = 3; i > 0; i--) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  function playTestSound() {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm uppercase tracking-wide text-slate-400">Device check</p>
      <h1 className="font-display text-3xl text-slate-900">Voice interview setup</h1>
      <p className="text-sm text-slate-600">
        Allow the microphone, run a 3-second test, and confirm you can hear playback. Camera is not
        required.
      </p>

      <div>
        <p className="mb-1 text-xs text-slate-500">Input level</p>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-600 transition-[width]"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={playTestSound}>
          Play test sound
        </Button>
        <Button type="button" onClick={runMicTest} disabled={!micReady || recording}>
          {recording ? `Recording… ${countdown}s` : "Record 3s mic test"}
        </Button>
      </div>

      {testUrl ? (
        <div className="space-y-1">
          <p className="text-xs text-slate-500">Playback your test recording</p>
          <audio src={testUrl} controls className="w-full" />
          {micOk ? (
            <p className="text-sm text-emerald-700">Mic test passed</p>
          ) : (
            <p className="text-sm text-rose-700">Recording too quiet — try again closer to the mic</p>
          )}
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Button className="w-full" disabled={!micOk} onClick={onContinue}>
        Continue
      </Button>
      <button
        type="button"
        className="w-full text-center text-sm text-slate-500 underline"
        onClick={onUseText}
      >
        Use text instead
      </button>
    </div>
  );
}
