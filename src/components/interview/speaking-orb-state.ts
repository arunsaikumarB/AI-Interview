import type { InterviewOrbLifecycle } from "./orb-state";

/**
 * Speaking Orb visual states. `searching` exists on the element but HireOS
 * has no separate "search" phase — generating and evaluating are both thinking.
 */
export type SpeakingOrbVisualState =
  | "listening"
  | "thinking"
  | "searching"
  | "speaking"
  | "done";

export type SpeakingOrbWord = {
  w: string;
  start: number;
  end: number;
};

/**
 * Desktop particle budget. Upstream auto-picks 12000, which is heavy on a
 * modest office PC. 6400 still reads as a dense sphere in WebGL.
 */
export const SPEAKING_ORB_PARTICLES_DESKTOP = 6400;
/** Phones and coarse pointers. Upstream auto-picks 6000; stay under that. */
export const SPEAKING_ORB_PARTICLES_COMPACT = 2800;
/** Quiet listening while the candidate has not started talking. */
export const SPEAKING_ORB_IDLE_LEVEL = 0.16;

/**
 * Priority matches the classic orb, with two visual differences the
 * thinking-orb preset cannot express:
 * - AI speaking is `speaking` (classic uses the same `breathing` pose as idle).
 * - Idle / candidate-ready is `listening` at a low level, not a speaking pose.
 * - Upload and evaluation are both `thinking`.
 * - A finished interview is `done`.
 */
export function mapLifecycleToSpeakingOrb(
  s: InterviewOrbLifecycle,
): SpeakingOrbVisualState {
  if (s.concluded) return "done";
  if (s.aiSpeaking) return "speaking";
  if (s.voiceSubmitting || s.processing) return "thinking";
  return "listening";
}

/** State the element returns to when Piper playback ends (`rest` attribute). */
export function speakingOrbRestState(
  s: InterviewOrbLifecycle,
): SpeakingOrbVisualState {
  return mapLifecycleToSpeakingOrb({ ...s, aiSpeaking: false });
}

export function speakingOrbParticleCount(opts: {
  width: number;
  coarsePointer: boolean;
}): number {
  if (opts.coarsePointer || opts.width < 768) return SPEAKING_ORB_PARTICLES_COMPACT;
  return SPEAKING_ORB_PARTICLES_DESKTOP;
}

export function clampSpeakingOrbLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level));
}
