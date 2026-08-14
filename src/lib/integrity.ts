/**
 * Interview integrity policy — browser-observable signals only.
 *
 * NOT process detection. Does not claim AnyDesk / TeamViewer / ChatGPT Desktop /
 * extensions / OS apps were identified. Focus/visibility/fullscreen/paste only.
 *
 * Never passed into AI prompts. Never auto-changes Application.stage.
 */

export type IntegrityMode = "STANDARD" | "STRICT";

export type IntegrityViolationKind =
  | "FOCUS_LOSS"
  | "FULLSCREEN_EXIT"
  | "PASTE";

/** Enhanced secondary-camera environment signals (on-device, not OS-app detection). */
export type SecondaryIntegrityKind =
  | "CAMERA_MOVED"
  | "PERSON_MISSING"
  | "EXTRA_PERSON"
  | "LOOKING_AT_SECONDARY";

export const SECONDARY_INTEGRITY_POLICY = {
  /** Candidate may correct this many times. The next episode after this ends the interview. */
  warningLimit: 3,
  terminateAt: 4,
  episodeCooldownMs: 1500,
} as const;

export function isSecondaryIntegrityKind(
  raw: string | null | undefined,
): raw is SecondaryIntegrityKind {
  return (
    raw === "CAMERA_MOVED" ||
    raw === "PERSON_MISSING" ||
    raw === "EXTRA_PERSON" ||
    raw === "LOOKING_AT_SECONDARY"
  );
}

/** Plain-language instruction so the candidate can fix the issue. Never technical. */
export function candidateSecondaryFixMessage(
  kind: SecondaryIntegrityKind,
): string {
  switch (kind) {
    case "PERSON_MISSING":
      return "The side camera cannot see the room. Uncover the phone and keep it pointed at you and your desk, then tap I’ve fixed this.";
    case "EXTRA_PERSON":
      return "Someone else is visible on the side camera. Only you should be in view. When the room is clear, tap I’ve fixed this.";
    case "LOOKING_AT_SECONDARY":
      return "Please look at the interview laptop, not the side camera. Face the laptop, then tap I’ve fixed this.";
    case "CAMERA_MOVED":
      return "The side camera moved. Put the phone back where it was and leave it still, then tap I’ve fixed this.";
  }
}

export function pendingSecondaryWarningDto(session: {
  integrityPendingWarningKind: string | null;
  integrityCameraMoveCount: number;
}): {
  kind: SecondaryIntegrityKind;
  warningNumber: number;
  warningOf: number;
  message: string;
} | null {
  if (!isSecondaryIntegrityKind(session.integrityPendingWarningKind)) {
    return null;
  }
  const of = SECONDARY_INTEGRITY_POLICY.warningLimit;
  return {
    kind: session.integrityPendingWarningKind,
    warningNumber: Math.min(
      Math.max(session.integrityCameraMoveCount, 1),
      of,
    ),
    warningOf: of,
    message: candidateSecondaryFixMessage(session.integrityPendingWarningKind),
  };
}

/** Default Strict thresholds — configurable via overrides on the session later if needed. */
export const STRICT_POLICY = {
  /** Focus/fullscreen episodes before terminate (1st = warn, 2nd = end). */
  focusTerminateAt: 2,
  /** Paste events before terminate (1st = warn, 2nd = end). */
  pasteTerminateAt: 2,
  /** Require fullscreen before Strict interview start. */
  requireFullscreen: true,
  /**
   * Client: coalesce blur/visibility events within this window into one episode.
   * Server: ignore duplicate episode posts within this window (idempotency aid).
   */
  episodeCooldownMs: 800,
} as const;

export function parseIntegrityMode(raw: unknown): IntegrityMode {
  return raw === "STRICT" ? "STRICT" : "STANDARD";
}

export function isIntegrityTerminatedStatus(status: string): boolean {
  return status === "TERMINATED";
}

/** Neutral recruiter-facing label for a stored proctoring / integrity signal. */
export function integritySignalLabel(params: {
  type: string;
  meta?: Record<string, unknown> | null;
}): string {
  const { type, meta } = params;
  if (type === "TAB_BLUR") return "Interview window lost focus";
  if (type === "TAB_FOCUS") return "Interview window regained focus";
  if (type === "FULLSCREEN_EXIT") return "Fullscreen exited";
  if (type === "COPY_PASTE") {
    const len =
      meta && typeof meta.pastedLength === "number" ? meta.pastedLength : null;
    return len != null
      ? `Paste observed (length ${len})`
      : "Paste observed";
  }
  if (type === "WINDOW_SWITCH") {
    const kind = meta?.kind;
    if (kind === "blur") return "Interview window lost focus";
    if (kind === "focus") return "Interview window regained focus";
    return "Window focus changed";
  }
  if (type === "SECONDARY_CAMERA_CONNECTED") return "Secondary camera connected";
  if (type === "SECONDARY_CAMERA_DISCONNECTED") {
    return "Secondary camera interruption";
  }
  if (type === "SECONDARY_CAMERA_MOVED") {
    return "Secondary camera interruption";
  }
  if (type === "SECONDARY_NO_FACE") {
    return "Candidate was not visible";
  }
  if (type === "SECONDARY_MULTIPLE_FACES") {
    return "Candidate visibility interrupted";
  }
  if (type === "SECONDARY_LOOKING_AT_DEVICE") {
    return "Candidate visibility interrupted";
  }
  return type.replaceAll("_", " ").toLowerCase();
}

export function terminationReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Interview ended by integrity policy";
  if (reason === "focus_threshold") {
    return "Interview ended by integrity policy (repeated window focus loss)";
  }
  if (reason === "paste_threshold") {
    return "Interview ended by integrity policy (repeated paste)";
  }
  if (reason === "fullscreen_threshold") {
    return "Interview ended by integrity policy (repeated fullscreen exit)";
  }
  if (reason === "secondary_camera_moved") {
    return "Interview ended (secondary camera was moved after placement)";
  }
  if (reason === "secondary_person_missing") {
    return "Interview ended (candidate not visible on secondary camera)";
  }
  if (reason === "secondary_extra_person") {
    return "Interview ended (another person visible on secondary camera)";
  }
  if (reason === "secondary_looking_at_device") {
    return "Interview ended (candidate looked at the secondary camera)";
  }
  return "Interview ended by integrity policy";
}
