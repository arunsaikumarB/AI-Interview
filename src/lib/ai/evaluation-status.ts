/**
 * R-3 — AI evaluation failure and retry handling.
 *
 * Recruiter-facing scoring runs in the background so the candidate is never
 * blocked on Ollama. That is the right design, but it meant a failure had
 * nowhere to go: `scoreInBackground` caught everything and only logged, so the
 * UI could not tell "still generating" from "gave up two minutes ago".
 *
 * This module keeps the fix small and schema-free:
 *
 *   - failures are recorded as a typed `AI_EVALUATION` TimelineEvent, the same
 *     row type a successful evaluation already writes;
 *   - the payload carries status/attempts/error and deliberately carries NO
 *     score, recommendation or reasoning, so a failure can never be mistaken
 *     for a result;
 *   - retries are bounded and only attempted for transient errors;
 *   - the existing staff-only `regenerate-evaluation` route remains the retry
 *     path, so no new queue or endpoint is introduced.
 *
 * Nothing here touches Application.stage — a failed evaluation is still just
 * an advisory signal that did not arrive.
 */

export const AI_EVALUATION_TIMELINE_KIND = "AI_EVALUATION" as const;

/** Initial attempt plus two retries. Finite by construction. */
export const MAX_EVALUATION_ATTEMPTS = 3;

/** Backoff between attempts. Short: the recruiter may be watching the page. */
export const EVALUATION_RETRY_DELAY_MS = 2_000;

const MAX_ERROR_CHARS = 300;

export type EvaluationKind = "INTERVIEW_ANSWER" | "INTERVIEW_OVERALL";

export type EvaluationTimelinePayload = {
  sessionId: string;
  kind: EvaluationKind;
  status: "completed" | "failed";
  advisoryOnly: true;
  attempts?: number;
  error?: string;
  overall?: number;
  recommendation?: string;
};

/**
 * Model output can be enormous and arbitrary. Keep enough to diagnose, not
 * enough to turn a timeline row into a transcript dump.
 */
export function redactEvaluationError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unknown evaluation error";
  const text = raw.trim() || "Unknown evaluation error";
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text;
}

/**
 * Retry transient failures only. A malformed model response or a validation
 * error will fail identically on the next attempt, so retrying it just burns
 * inference time.
 */
export function isRetryableEvaluationError(err: unknown, attempt: number): boolean {
  if (attempt >= MAX_EVALUATION_ATTEMPTS) return false;

  const kind = (err as { kind?: string } | null)?.kind;
  if (kind === "VALIDATION") return false;
  if (kind === "UNREACHABLE" || kind === "TIMEOUT" || kind === "HTTP") return true;

  const message = err instanceof Error ? err.message.toLowerCase() : String(err ?? "").toLowerCase();
  if (/malformed|invalid json|schema|validation/.test(message)) return false;
  return true;
}

export function evaluationFailurePayload(params: {
  sessionId: string;
  kind: EvaluationKind;
  attempts: number;
  error: unknown;
}): EvaluationTimelinePayload {
  return {
    sessionId: params.sessionId,
    kind: params.kind,
    status: "failed",
    advisoryOnly: true,
    attempts: params.attempts,
    error: redactEvaluationError(params.error),
  };
}

export function evaluationSuccessPayload(params: {
  sessionId: string;
  kind: EvaluationKind;
  overall?: number;
  recommendation?: string;
}): EvaluationTimelinePayload {
  return {
    sessionId: params.sessionId,
    kind: params.kind,
    status: "completed",
    advisoryOnly: true,
    ...(params.overall !== undefined ? { overall: params.overall } : {}),
    ...(params.recommendation !== undefined ? { recommendation: params.recommendation } : {}),
  };
}

export type EvaluationState = {
  state: "not_applicable" | "pending" | "completed" | "failed";
  canRetry: boolean;
  attempts?: number;
  error?: string;
};

/**
 * The single source of truth the API and the UI both use.
 *
 * `hasOverall` is the only evidence that an evaluation actually exists — the
 * timeline row is a breadcrumb, not the result — so a stored evaluation always
 * wins over an older failure breadcrumb.
 */
export function deriveEvaluationState(input: {
  sessionStatus: string;
  hasOverall: boolean;
  latestEvent: { status?: string; kind?: string; attempts?: number; error?: string } | null;
}): EvaluationState {
  const finished = input.sessionStatus === "COMPLETED" || input.sessionStatus === "TERMINATED";

  if (input.hasOverall) return { state: "completed", canRetry: true };
  if (!finished) return { state: "not_applicable", canRetry: false };

  const failure =
    input.latestEvent?.status === "failed" &&
    input.latestEvent.kind === "INTERVIEW_OVERALL"
      ? input.latestEvent
      : null;

  if (failure) {
    return {
      state: "failed",
      canRetry: true,
      attempts: failure.attempts,
      error: failure.error,
    };
  }

  // Finished, nothing stored, nothing recorded as failed: generation is still
  // in flight. Two minutes on CPU-bound Ollama is normal.
  return { state: "pending", canRetry: true };
}
