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
  | "PERSON_MOVED"
  | "PERSON_RETURNED"
  | "EXTRA_PERSON"
  | "LOOKING_AT_SECONDARY"
  | "ATTENTION_DEVIATION"
  | "DEVICE_VISIBLE"
  | "DEVICE_REMOVED"
  | "DEVICE_INTERACTION"
  | "PERSON_RETURNED_TO_ONE"
  | "PERSON_INTERACTION";

export const SECONDARY_INFO_KINDS = new Set<SecondaryIntegrityKind>([
  "PERSON_RETURNED",
  "DEVICE_REMOVED",
  "PERSON_RETURNED_TO_ONE",
]);

export const SECONDARY_INTEGRITY_POLICY = {
  /** Candidate may correct this many times. The next episode after this ends the interview. */
  warningLimit: 3,
  terminateAt: 4,
  episodeCooldownMs: 1500,
} as const;


/**
 * F-05 R5 — only STRICT may end an interview from secondary-camera signals.
 *
 * STANDARD still records every timestamped signal and still warns the
 * candidate, so recruiters keep full review visibility; it simply never
 * terminates. Run C ended a STANDARD interview after 44 seconds with zero
 * questions answered, because termination was gated only on ENHANCED
 * proctoring and ignored integrityMode entirely — unlike the browser
 * integrity path, which already returns early when mode !== "STRICT".
 */
export function secondaryTerminationEnabled(
  mode: "STANDARD" | "STRICT",
): boolean {
  return mode === "STRICT";
}

export function shouldTerminateSecondary(params: {
  mode: "STANDARD" | "STRICT";
  nextCount: number;
  terminateAt?: number;
}): boolean {
  if (!secondaryTerminationEnabled(params.mode)) return false;
  return (
    params.nextCount >=
    (params.terminateAt ?? SECONDARY_INTEGRITY_POLICY.terminateAt)
  );
}

/* ── F-05 audit evidence ─────────────────────────────────────────────────
 *
 * `InterviewSession.secondaryPlacementConfirmedAt` is transient: it is cleared
 * on reconnect, placement reset, disconnect and session end, so after a run it
 * cannot show when placement happened. Run D lost exactly that evidence and the
 * R1 invariant became unprovable retrospectively.
 *
 * These records are append-only TimelineEvents (the same `type: "OTHER"` +
 * `payload.kind` mechanism already used by PROCTORING_CONSENT and
 * integrity_terminated). They are EVIDENCE ONLY — they change no detection,
 * no thresholds, no termination behaviour.
 *
 * Deliberately not ProctoringEvent: the staff report counts every row of that
 * table, so audit records would inflate the recruiter-facing signal counts.
 */

export const SECONDARY_AUDIT_KIND = {
  placementConfirmed: "secondary_placement_confirmed",
  baselineCaptured: "secondary_baseline_captured",
} as const;

/** Flags every advisory payload carries, so audit rows read the same way. */
const ADVISORY_FLAGS = {
  advisoryOnly: true,
  noAtsStageChange: true,
  noAiInput: true,
  source: "secondary_camera",
} as const;

export function secondaryPlacementAuditPayload(params: {
  sessionId: string;
  confirmedAt: Date;
}): Record<string, unknown> {
  return {
    ...ADVISORY_FLAGS,
    kind: SECONDARY_AUDIT_KIND.placementConfirmed,
    sessionId: params.sessionId,
    confirmedAt: params.confirmedAt.toISOString(),
  };
}

/**
 * The baseline record carries the placement it belongs to, so a reconnect
 * (which produces a new placement + new baseline) stays unambiguous, and the
 * R1 invariant is checkable from the row alone.
 */
export function secondaryBaselineAuditPayload(params: {
  sessionId: string;
  capturedAt: Date;
  settled: boolean;
  placementConfirmedAt: Date | null;
}): Record<string, unknown> {
  return {
    ...ADVISORY_FLAGS,
    kind: SECONDARY_AUDIT_KIND.baselineCaptured,
    sessionId: params.sessionId,
    capturedAt: params.capturedAt.toISOString(),
    settled: params.settled,
    placementConfirmedAt: params.placementConfirmedAt
      ? params.placementConfirmedAt.toISOString()
      : null,
    invariantHeld: baselineFollowsPlacement(
      params.capturedAt,
      params.placementConfirmedAt,
    ),
  };
}

/** The R1 invariant: a baseline must never predate its placement. */
export function baselineFollowsPlacement(
  capturedAt: Date,
  placementConfirmedAt: Date | null,
): boolean {
  if (!placementConfirmedAt) return false;
  return capturedAt.getTime() >= placementConfirmedAt.getTime();
}

export type BaselineReport = { capturedAt: Date; settled: boolean };

/**
 * Parse the optional baseline fields off an existing heartbeat body.
 *
 * Returns null for any body that does not carry a well-formed report, so a
 * heartbeat without them (every heartbeat before this change) stays valid.
 * A malformed timestamp is rejected rather than silently stored.
 */
export function parseBaselineReport(raw: unknown): BaselineReport | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const at = body.baselineCapturedAt;
  if (typeof at !== "string" || at.trim() === "") return null;
  const capturedAt = new Date(at);
  if (Number.isNaN(capturedAt.getTime())) return null;
  // Guard against a wildly wrong device clock being written as evidence.
  const skewMs = Math.abs(Date.now() - capturedAt.getTime());
  if (skewMs > 24 * 60 * 60 * 1000) return null;
  return { capturedAt, settled: body.baselineSettled === true };
}

export function isSecondaryIntegrityKind(
  raw: string | null | undefined,
): raw is SecondaryIntegrityKind {
  return (
    raw === "CAMERA_MOVED" ||
    raw === "PERSON_MISSING" ||
    raw === "PERSON_MOVED" ||
    raw === "PERSON_RETURNED" ||
    raw === "EXTRA_PERSON" ||
    raw === "LOOKING_AT_SECONDARY" ||
    raw === "ATTENTION_DEVIATION" ||
    raw === "DEVICE_VISIBLE" ||
    raw === "DEVICE_REMOVED" ||
    raw === "DEVICE_INTERACTION" ||
    raw === "PERSON_RETURNED_TO_ONE" ||
    raw === "PERSON_INTERACTION"
  );
}

/** Plain-language instruction so the candidate can fix the issue. Never technical. */
export function candidateSecondaryFixMessage(
  kind: SecondaryIntegrityKind,
): string {
  switch (kind) {
    case "PERSON_MISSING":
      return "Please return to your interview position. The side camera cannot see you in the room.";
    case "PERSON_MOVED":
      return "Please return to your normal interview position and remain seated.";
    case "PERSON_RETURNED":
      return "You are visible again. Continue the interview.";
    case "EXTRA_PERSON":
      return "Another person has been detected in the interview area. Please ensure that you are alone and return your attention to the interview.";
    case "PERSON_RETURNED_TO_ONE":
      return "Only you are visible again. Continue the interview.";
    case "PERSON_INTERACTION":
      return "Please continue the interview without assistance from another person.";
    case "LOOKING_AT_SECONDARY":
      return "Please look at the interview laptop, not the side camera.";
    case "ATTENTION_DEVIATION":
      return "Please return your attention to the interview.";
    case "DEVICE_VISIBLE":
      return "Additional device activity detected. Please put other phones or tablets away.";
    case "DEVICE_REMOVED":
      return "The extra device is no longer visible. Continue the interview.";
    case "DEVICE_INTERACTION":
      return "Possible external-device activity — please keep your attention on the interview laptop.";
    case "CAMERA_MOVED":
      return "Secondary camera moved. Please return it to the original position.";
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
    return "Secondary camera moved";
  }
  if (type === "SECONDARY_NO_FACE") {
    return "Candidate was not visible";
  }
  if (type === "SECONDARY_MULTIPLE_FACES") {
    return "Additional person detected";
  }
  if (type === "SECONDARY_MULTIPLE_PERSONS") {
    return "Additional person detected";
  }
  if (type === "SECONDARY_PERSON_RETURNED_TO_ONE") {
    return "Additional person no longer detected";
  }
  if (type === "SECONDARY_PERSON_INTERACTION") {
    return "Possible interaction with another person detected. Review recommended.";
  }
  if (type === "SECONDARY_LOOKING_AT_DEVICE") {
    return "Attention toward the side camera";
  }
  if (type === "SECONDARY_PERSON_MOVED") {
    return "Candidate position changed";
  }
  if (type === "SECONDARY_PERSON_RETURNED") {
    return "Candidate returned to interview position";
  }
  if (type === "SECONDARY_ATTENTION_DEVIATION") {
    return "Attention deviation";
  }
  if (type === "SECONDARY_DEVICE_VISIBLE") {
    return "Possible additional-device activity";
  }
  if (type === "SECONDARY_DEVICE_REMOVED") {
    return "Additional device no longer visible";
  }
  if (type === "SECONDARY_DEVICE_INTERACTION") {
    return "Possible interaction with an additional device";
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
  if (reason === "secondary_person_moved") {
    return "Interview ended (candidate left the expected interview position)";
  }
  if (reason === "secondary_attention") {
    return "Interview ended (repeated attention deviation)";
  }
  if (reason === "secondary_person_interaction") {
    return "Interview ended (possible interaction with another person)";
  }
  return "Interview ended by integrity policy";
}
