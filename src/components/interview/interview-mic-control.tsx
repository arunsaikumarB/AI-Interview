"use client";

import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export function InterviewMicControl({
  recording,
  thinking,
  aiSpeaking,
  reducedMotion,
  elapsedLabel,
  onToggle,
}: {
  recording: boolean;
  thinking: boolean;
  aiSpeaking?: boolean;
  reducedMotion: boolean;
  elapsedLabel?: string;
  onToggle: () => void;
}) {
  const waiting = Boolean(aiSpeaking || (thinking && !recording));
  const label = waiting
    ? "Waiting for AI…"
    : recording
      ? "Recording… Press to submit"
      : "Press to answer";

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={waiting}
        aria-pressed={recording}
        aria-label={recording ? "Stop and submit answer" : "Start recording answer"}
        className={cn(
          "relative flex size-16 items-center justify-center rounded-full outline-none transition-all duration-300",
          "focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]",
          "disabled:pointer-events-none disabled:opacity-45",
          recording
            ? "bg-red-500 text-white shadow-[0_0_0_6px_rgba(239,68,68,0.2)]"
            : "bg-sky-500 text-white shadow-[0_8px_28px_rgba(14,165,233,0.35)] hover:bg-sky-400",
        )}
      >
        {recording && !reducedMotion ? (
          <span
            className="absolute inset-0 animate-ping rounded-full bg-red-400/30"
            aria-hidden
          />
        ) : null}
        {recording ? (
          <Square className="relative size-5 fill-current" aria-hidden />
        ) : (
          <Mic className="relative size-6" aria-hidden />
        )}
      </button>
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-200">
          {label}
          {recording && elapsedLabel ? (
            <span className="tabular-nums text-zinc-400"> · {elapsedLabel}</span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-zinc-500">No hard time limit</p>
      </div>
    </div>
  );
}
