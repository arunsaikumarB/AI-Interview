"use client";

import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./interview-ui.module.css";

export function InterviewMicControl({
  recording,
  thinking,
  reducedMotion,
  elapsedLabel,
  onToggle,
}: {
  recording: boolean;
  thinking: boolean;
  reducedMotion: boolean;
  elapsedLabel?: string;
  onToggle: () => void;
}) {
  const processing = thinking && !recording;
  const label = processing
    ? "Processing…"
    : recording
      ? "Recording"
      : "Listening…";

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        disabled={thinking}
        aria-pressed={recording}
        aria-label={recording ? "Stop and send" : "Press to record"}
        className={cn(
          "relative flex size-12 items-center justify-center rounded-full outline-none transition-colors duration-300",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          recording
            ? "bg-red-500 text-white"
            : "border border-border bg-transparent text-foreground hover:bg-muted/40",
          processing && "opacity-80",
        )}
      >
        {recording && !reducedMotion ? (
          <span className={styles.micPulse} aria-hidden />
        ) : null}
        {recording ? (
          <span
            className="absolute right-1 top-1 size-2 rounded-full bg-orange-400"
            aria-hidden
          />
        ) : null}
        <Mic className="size-5" aria-hidden />
      </button>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {recording ? (
          <span className="size-1.5 rounded-full bg-orange-400" aria-hidden />
        ) : null}
        <span>
          {label}
          {recording && elapsedLabel ? ` · ${elapsedLabel}` : ""}
        </span>
      </p>
    </div>
  );
}
