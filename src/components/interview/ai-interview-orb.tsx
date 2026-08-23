"use client";

import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { cn } from "@/lib/utils";
import {
  THINKING_ORB_CANVAS_SIZE,
  THINKING_ORB_SPEED,
  type InterviewThinkingOrbState,
} from "./orb-state";

interface AIInterviewOrbProps {
  state: InterviewThinkingOrbState;
  heading?: string;
  statusLabel?: string;
  guidance?: string;
  reducedMotion?: boolean;
  className?: string;
  /** Visual diameter — smaller in the two-column layout so the question stays primary. */
  size?: number;
}

export function AIInterviewOrb({
  state,
  heading = "AI Interviewer",
  statusLabel,
  guidance,
  reducedMotion = false,
  className,
  size: sizeProp,
}: AIInterviewOrbProps) {
  const [displaySize, setDisplaySize] = useState(sizeProp ?? 200);

  useEffect(() => {
    if (sizeProp != null) {
      setDisplaySize(sizeProp);
      return;
    }
    const apply = () => {
      const vw = window.innerWidth;
      if (vw >= 1280) setDisplaySize(220);
      else if (vw >= 1024) setDisplaySize(180);
      else setDisplaySize(148);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [sizeProp]);

  return (
    <div
      className={cn("relative flex flex-col items-center text-center", className)}
      data-orb-state={state}
      data-thinking-orb={state}
      role="status"
      aria-live="polite"
      aria-label={`${heading}. ${statusLabel ?? ""}. ${guidance ?? ""}`}
    >
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300/90">
        {heading}
      </p>
      {statusLabel ? (
        <p className="mb-3 max-w-md text-sm text-zinc-300">{statusLabel}</p>
      ) : null}
      {guidance ? (
        <p className="mb-4 max-w-lg text-xs leading-relaxed text-zinc-500">
          {guidance}
        </p>
      ) : null}

      <div
        className="relative flex items-center justify-center"
        style={{ width: displaySize, height: displaySize }}
      >
        <ThinkingOrb
          state={state}
          size={THINKING_ORB_CANVAS_SIZE}
          speed={THINKING_ORB_SPEED}
          paused={reducedMotion}
          theme="dark"
          style={{
            width: displaySize,
            height: displaySize,
            display: "block",
          }}
          aria-hidden
        />
      </div>

      <span
        className={cn(
          "mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide",
          state === "breathing" &&
            "border-violet-400/30 bg-violet-500/10 text-violet-200",
          state === "listening" &&
            "border-sky-400/30 bg-sky-500/10 text-sky-200",
          state === "composing" &&
            "border-amber-400/30 bg-amber-500/10 text-amber-100",
          state === "connecting" &&
            "border-indigo-400/30 bg-indigo-500/10 text-indigo-200",
        )}
      >
        <span className="opacity-70" aria-hidden>
          ✦
        </span>
        {state}
      </span>
    </div>
  );
}
