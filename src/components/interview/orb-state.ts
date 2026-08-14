"use client";

import { useEffect, useRef, useState } from "react";

export type OrbState =
  | "IDLE"
  | "THINKING"
  | "AI_SPEAKING"
  | "CANDIDATE_LISTENING"
  | "CANDIDATE_SPEAKING"
  | "PROCESSING"
  | "COMPLETED";

/** Read-only snapshot of existing InterviewRoom flags — no engine state. */
export type ExistingInterviewVisualState = {
  concluded: boolean;
  status?: string | null;
  thinking: boolean;
  pendingProcessing: boolean;
  recording: boolean;
  hasActiveQuestion: boolean;
  hasError: boolean;
  /** True for ~2s after a new question sequence appears (TTS may be playing). */
  questionJustArrived: boolean;
};

export function deriveOrbState(s: ExistingInterviewVisualState): OrbState {
  if (s.concluded || s.status === "COMPLETED") return "COMPLETED";
  if (s.pendingProcessing) return "PROCESSING";
  if (s.thinking) {
    return s.hasActiveQuestion ? "PROCESSING" : "THINKING";
  }
  if (s.recording) return "CANDIDATE_SPEAKING";
  if (
    s.hasError &&
    !s.recording &&
    !s.thinking &&
    !s.pendingProcessing
  ) {
    return "IDLE";
  }
  if (s.hasActiveQuestion && s.questionJustArrived) return "AI_SPEAKING";
  if (s.hasActiveQuestion) return "CANDIDATE_LISTENING";
  return "IDLE";
}

export function orbStatusLabel(
  state: OrbState,
  opts?: { hasError?: boolean },
): string | undefined {
  if (opts?.hasError && (state === "IDLE" || state === "THINKING")) {
    return "One moment…";
  }
  switch (state) {
    case "THINKING":
      return "Thinking…";
    case "PROCESSING":
      return "Reviewing your response…";
    case "CANDIDATE_LISTENING":
      return "Your turn — take your time";
    case "COMPLETED":
      return "Interview complete";
    default:
      return undefined;
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

const ORB_DEBOUNCE_MS = 280;
const AI_SPEAKING_MS = 2000;

export function useOrbState(input: {
  concluded: boolean;
  status?: string | null;
  thinking: boolean;
  pendingProcessing: boolean;
  recording: boolean;
  hasActiveQuestion: boolean;
  hasError: boolean;
  questionSequence: number | null;
  answeredCount: number;
}): { orbState: OrbState; statusLabel: string | undefined } {
  const [questionJustArrived, setQuestionJustArrived] = useState(false);
  const seenSequenceRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const seq = input.questionSequence;
    if (seq == null) return;

    const prev = seenSequenceRef.current;
    seenSequenceRef.current = seq;

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      // Resume with existing answers: don't flash AI_SPEAKING on the current question.
      if (input.answeredCount > 0) return;
    }

    if (prev === seq) return;

    setQuestionJustArrived(true);
    const t = window.setTimeout(() => setQuestionJustArrived(false), AI_SPEAKING_MS);
    return () => window.clearTimeout(t);
  }, [input.questionSequence, input.answeredCount]);

  const derived = deriveOrbState({
    concluded: input.concluded,
    status: input.status,
    thinking: input.thinking,
    pendingProcessing: input.pendingProcessing,
    recording: input.recording,
    hasActiveQuestion: input.hasActiveQuestion,
    hasError: input.hasError,
    questionJustArrived,
  });

  const [orbState, setOrbState] = useState<OrbState>(derived);
  const skipDebounceRef = useRef(true);

  useEffect(() => {
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false;
      setOrbState(derived);
      return;
    }
    const t = window.setTimeout(() => setOrbState(derived), ORB_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [derived]);

  return {
    orbState,
    statusLabel: orbStatusLabel(orbState, { hasError: input.hasError }),
  };
}
