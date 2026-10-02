"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  /** Size the orb to the space left in its parent (parent must give it a bounded height). */
  fill?: boolean;
  /**
   * Replaces the ThinkingOrb canvas inside the same sized slot.
   * Omit to keep the classic orb.
   */
  visual?: (size: number) => ReactNode;
  /** Badge text. Omit to keep the classic state name (`breathing`, …). */
  badgeLabel?: string;
  /** `data-orb-variant` for the active interviewer face. */
  variantLabel?: "speaking" | "classic";
}

function speakingBadgeClass(label: string): string {
  switch (label) {
    case "listening":
      return "border-amber-400/30 bg-amber-500/10 text-amber-100";
    case "thinking":
      return "border-violet-400/30 bg-violet-500/10 text-violet-100";
    case "speaking":
      return "border-pink-400/30 bg-pink-500/10 text-pink-100";
    case "done":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
    case "searching":
      return "border-cyan-400/30 bg-cyan-500/10 text-cyan-100";
    default:
      return "border-white/15 bg-white/5 text-zinc-200";
  }
}

const FILL_MIN = 40;
const FILL_COMPACT_BELOW = 260;

export function AIInterviewOrb({
  state,
  heading = "AI Interviewer",
  statusLabel,
  guidance,
  reducedMotion = false,
  className,
  size: sizeProp,
  fill = false,
  visual,
  badgeLabel,
  variantLabel,
}: AIInterviewOrbProps) {
  const [displaySize, setDisplaySize] = useState(sizeProp ?? (fill ? FILL_MIN : 200));
  const [compact, setCompact] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fill || sizeProp != null) return;
    const root = rootRef.current;
    const slot = slotRef.current;
    if (!root || !slot) return;
    const apply = () => {
      const vw = window.innerWidth;
      const byWidth = vw >= 1280 ? 220 : vw >= 1024 ? 180 : 148;
      // Compact is decided from the root (bounded by the parent), not the slot, so hiding
      // text cannot feed back into the measurement and make the orb flicker between sizes.
      setCompact(root.clientHeight < FILL_COMPACT_BELOW);
      const fit = Math.floor(Math.min(slot.clientHeight, slot.clientWidth, byWidth));
      setDisplaySize(Math.max(FILL_MIN, fit));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(root);
    ro.observe(slot);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [fill, sizeProp]);

  useEffect(() => {
    if (fill && sizeProp == null) return;
    if (sizeProp != null) {
      setDisplaySize(sizeProp);
      return;
    }
    const apply = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const byWidth = vw >= 1280 ? 220 : vw >= 1024 ? 180 : 148;
      // Short laptop windows: the question must stay visible, so the orb gives way first.
      const byHeight = vh >= 960 ? 220 : vh >= 820 ? 160 : vh >= 720 ? 96 : 72;
      setDisplaySize(Math.min(byWidth, byHeight));
      setCompact(vh < 820);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [fill, sizeProp]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex flex-col items-center text-center",
        fill && "h-full min-h-0",
        className,
      )}
      data-orb-state={state}
      data-thinking-orb={state}
      data-orb-variant={variantLabel}
      role="status"
      aria-live="polite"
      aria-label={`${heading}. ${statusLabel ?? ""}. ${guidance ?? ""}`}
    >
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300/90">
        {heading}
      </p>
      {statusLabel ? (
        <p className={cn("max-w-md text-sm text-zinc-300", compact ? "mb-2" : "mb-3")}>{statusLabel}</p>
      ) : null}
      {guidance && !compact ? (
        <p className="mb-4 max-w-lg text-xs leading-relaxed text-zinc-500">
          {guidance}
        </p>
      ) : null}

      <div
        ref={slotRef}
        className={cn(
          "relative flex items-center justify-center",
          fill && "min-h-0 w-full flex-1 overflow-hidden",
        )}
        style={fill ? undefined : { width: displaySize, height: displaySize }}
      >
        {visual ? (
          visual(displaySize)
        ) : (
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
        )}
      </div>

      <span
        className={cn(
          "mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide",
          compact && "hidden",
          !badgeLabel &&
            state === "breathing" &&
            "border-violet-400/30 bg-violet-500/10 text-violet-200",
          !badgeLabel &&
            state === "listening" &&
            "border-sky-400/30 bg-sky-500/10 text-sky-200",
          !badgeLabel &&
            state === "composing" &&
            "border-amber-400/30 bg-amber-500/10 text-amber-100",
          !badgeLabel &&
            state === "connecting" &&
            "border-indigo-400/30 bg-indigo-500/10 text-indigo-200",
          badgeLabel ? speakingBadgeClass(badgeLabel) : null,
        )}
      >
        <span className="opacity-70" aria-hidden>
          ✦
        </span>
        {badgeLabel ?? state}
      </span>
    </div>
  );
}
