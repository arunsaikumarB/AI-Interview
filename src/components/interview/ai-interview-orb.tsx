"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { OrbState } from "./orb-state";
import styles from "./interview-ui.module.css";

interface AIInterviewOrbProps {
  state: OrbState;
  size?: number;
  reducedMotion?: boolean;
  statusLabel?: string;
}

export function AIInterviewOrb({
  state,
  size,
  reducedMotion = false,
  statusLabel,
}: AIInterviewOrbProps) {
  const announced =
    statusLabel ??
    (state === "CANDIDATE_SPEAKING" ? "Recording" : "AI Interviewer");

  return (
    <div
      className={styles.root}
      data-state={state}
      data-reduced={reducedMotion ? "true" : "false"}
      style={
        size
          ? ({
              "--orb-size": `${size}px`,
            } as CSSProperties)
          : undefined
      }
      role="status"
      aria-live="polite"
      aria-label={announced}
    >
      <div className={styles.stage}>
        <div className={cn(styles.layer, styles.aura)} />
        <div className={cn(styles.layer, styles.blob)} />
        <div className={cn(styles.layer, styles.core)}>
          <div className={styles.sphere} />
          <div className={styles.drift} />
          <div className={styles.specular} />
          <div className={cn(styles.tint, styles.tintCyan)} />
          <div className={cn(styles.tint, styles.tintCalm)} />
          <div className={cn(styles.tint, styles.tintDone)} />
        </div>
      </div>
      <p className={styles.title}>AI Interviewer</p>
      <p className={cn(styles.label, statusLabel && styles.labelOn)}>
        {statusLabel ?? "\u00a0"}
      </p>
    </div>
  );
}
