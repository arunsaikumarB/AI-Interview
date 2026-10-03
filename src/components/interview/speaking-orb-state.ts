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
 * Desktop particle budget. Upstream auto-picks 12000. 8800 is denser than the
 * first pass (6400) and still under that ceiling for a modest office PC.
 * Point size is also raised slightly in the vendored painter.
 */
export const SPEAKING_ORB_PARTICLES_DESKTOP = 8800;
/** Phones and coarse pointers. Above the first pass (2800), under upstream's 6000. */
export const SPEAKING_ORB_PARTICLES_COMPACT = 4200;
/**
 * Preview at 1440×900 used to measure 160px. 1.65× is 264px, inside the
 * 240–280 band, and uses the open space above the question card.
 * Taller slots are capped so the sphere does not crowd the badge.
 */
export const SPEAKING_ORB_SCALE = 1.65;
export const SPEAKING_ORB_MAX_PX = 280;

/** Classic measured diameter → speaking-orb diameter. */
export function scaleSpeakingOrbSize(base: number): number {
  if (!Number.isFinite(base)) return base;
  return Math.min(SPEAKING_ORB_MAX_PX, Math.max(1, Math.round(base * SPEAKING_ORB_SCALE)));
}
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
