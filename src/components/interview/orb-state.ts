"use client";

import { useEffect, useState } from "react";

/**
 * ThinkingOrb package states used by the interview UI.
 * Deterministic mapping from real lifecycle flags — no timers.
 */
export type InterviewThinkingOrbState =
  | "breathing"
  | "listening"
  | "composing"
  | "connecting";

export const THINKING_ORB_DESIGN_SIZE = 512;
export const THINKING_ORB_SPEED = 0.45;
/** thinking-orbs only ships canvas presets 64 | 20; we stretch 64 → design size. */
export const THINKING_ORB_CANVAS_SIZE = 64 as const;

/** Primary UI phase — only one active at a time. */
export type InterviewUiPhase =
  | "AI_SPEAKING"
  | "CANDIDATE_READY"
  | "CANDIDATE_RECORDING"
  | "ANSWER_SUBMITTING"
  | "AI_ANALYZING"
  | "IDLE";

export type InterviewOrbLifecycle = {
  aiSpeaking: boolean;
  /** Mic is actively recording the candidate answer. */
  candidateRecording: boolean;
  voiceSubmitting: boolean;
  processing: boolean;
  concluded?: boolean;
};

/**
 * Priority (highest first):
 * 1. AI speaking → breathing
 * 2. Voice submitting (upload) → composing
 * 3. AI analyzing → connecting
 * 4. Candidate recording → listening
 * 5. Otherwise → breathing (calm idle while candidate is ready)
 */
export function deriveInterviewThinkingOrbState(
  s: InterviewOrbLifecycle,
): InterviewThinkingOrbState {
  if (s.aiSpeaking) return "breathing";
  if (s.voiceSubmitting) return "composing";
  if (s.processing) return "connecting";
  if (s.candidateRecording) return "listening";
  return "breathing";
}

export function deriveInterviewUiPhase(
  s: InterviewOrbLifecycle,
): InterviewUiPhase {
  if (s.aiSpeaking) return "AI_SPEAKING";
  if (s.voiceSubmitting) return "ANSWER_SUBMITTING";
  if (s.processing) return "AI_ANALYZING";
  if (s.candidateRecording) return "CANDIDATE_RECORDING";
  return "CANDIDATE_READY";
}

export function thinkingOrbStatusLabel(
  state: InterviewThinkingOrbState,
  phase?: InterviewUiPhase,
): string {
  if (phase === "CANDIDATE_READY") return "Click the mic when you are ready";
  switch (state) {
    case "listening":
      return "Listening…";
    case "composing":
      return "Processing your answer…";
    case "connecting":
      return "Understanding your response…";
    case "breathing":
    default:
      return "AI is asking a question";
  }
}

export function thinkingOrbHeading(
  state: InterviewThinkingOrbState,
  phase?: InterviewUiPhase,
): string {
  if (phase === "CANDIDATE_READY") return "Your turn";
  switch (state) {
    case "listening":
      return "Your turn";
    case "composing":
      return "Processing your answer";
    case "connecting":
      return "AI is analyzing";
    case "breathing":
    default:
      return "AI Interviewer";
  }
}

export function thinkingOrbGuidance(
  state: InterviewThinkingOrbState,
  phase?: InterviewUiPhase,
): string {
  if (phase === "CANDIDATE_READY") {
    return "Speak clearly and take your time to respond.";
  }
  switch (state) {
    case "listening":
      return "Speak clearly and take your time.";
    case "composing":
      return "Your response is being prepared…";
    case "connecting":
      return "Understanding your response…";
    case "breathing":
    default:
      return "Please listen carefully and take your time to respond.";
  }
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function useInterviewThinkingOrb(lifecycle: InterviewOrbLifecycle): {
  orbState: InterviewThinkingOrbState;
  statusLabel: string;
  heading: string;
  guidance: string;
  phase: InterviewUiPhase;
} {
  const orbState = deriveInterviewThinkingOrbState(lifecycle);
  const phase = deriveInterviewUiPhase(lifecycle);
  return {
    orbState,
    statusLabel: thinkingOrbStatusLabel(orbState, phase),
    heading: thinkingOrbHeading(orbState, phase),
    guidance: thinkingOrbGuidance(orbState, phase),
    phase,
  };
}

/** @deprecated */
export type OrbState = InterviewThinkingOrbState;
