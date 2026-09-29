/**
 * Practical assessment lifecycle. Pure — no imports from Prisma so it can be
 * unit-tested and reused by the service layer.
 *
 *   NOT_STARTED → STARTED → IN_PROGRESS → SUBMITTED → EXECUTING → COMPLETED
 *   failure states: EXECUTION_FAILED, TIMEOUT, CANCELLED
 *
 * The candidate can only trigger start, autosave and submit. EXECUTING and every
 * terminal state are set by the server executor. There is no PASSED / FAILED /
 * score state at all — results are evidence, not verdicts.
 */

export const PRACTICAL_STATUSES = [
  "NOT_STARTED",
  "STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "EXECUTING",
  "COMPLETED",
  "EXECUTION_FAILED",
  "TIMEOUT",
  "CANCELLED",
] as const;
export type PracticalStatusValue = (typeof PRACTICAL_STATUSES)[number];

const TRANSITIONS: Record<PracticalStatusValue, readonly PracticalStatusValue[]> = {
  NOT_STARTED: ["STARTED", "CANCELLED"],
  STARTED: ["IN_PROGRESS", "SUBMITTED", "TIMEOUT", "CANCELLED"],
  IN_PROGRESS: ["SUBMITTED", "TIMEOUT", "CANCELLED"],
  SUBMITTED: ["EXECUTING", "EXECUTION_FAILED"],
  EXECUTING: ["COMPLETED", "EXECUTION_FAILED", "TIMEOUT"],
  COMPLETED: [],
  EXECUTION_FAILED: [],
  TIMEOUT: [],
  CANCELLED: [],
};

export type PracticalActor = "CANDIDATE" | "STAFF" | "EXECUTOR" | "SYSTEM";

/** Which actor may cause which target state. */
const ACTOR_TARGETS: Record<PracticalActor, readonly PracticalStatusValue[]> = {
  CANDIDATE: ["STARTED", "IN_PROGRESS", "SUBMITTED"],
  STAFF: ["CANCELLED"],
  EXECUTOR: ["EXECUTING", "COMPLETED", "EXECUTION_FAILED", "TIMEOUT"],
  SYSTEM: ["TIMEOUT"],
};

export class PracticalLifecycleError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly actor: PracticalActor,
  ) {
    super(`Transition ${from} → ${to} is not allowed for ${actor}`);
    this.name = "PracticalLifecycleError";
  }
}

export function isPracticalStatus(value: unknown): value is PracticalStatusValue {
  return typeof value === "string" && (PRACTICAL_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: PracticalStatusValue): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: PracticalStatusValue, to: PracticalStatusValue, actor: PracticalActor): boolean {
  return TRANSITIONS[from].includes(to) && ACTOR_TARGETS[actor].includes(to);
}

export function assertTransition(from: string, to: string, actor: PracticalActor): void {
  if (!isPracticalStatus(from) || !isPracticalStatus(to) || !canTransition(from, to, actor)) {
    throw new PracticalLifecycleError(from, to, actor);
  }
}

/** Candidate may keep editing (autosave / run) only while the attempt is open. */
export function isEditable(status: PracticalStatusValue): boolean {
  return status === "STARTED" || status === "IN_PROGRESS";
}

export type ExecStatusValue = "PENDING" | "EXECUTING" | "COMPLETED" | "EXECUTION_FAILED" | "TIMEOUT";

/** Maps the executor outcome of the frozen submission onto the assessment state. */
export function assessmentStatusForExec(exec: ExecStatusValue): PracticalStatusValue {
  switch (exec) {
    case "COMPLETED":
      return "COMPLETED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "EXECUTION_FAILED":
      return "EXECUTION_FAILED";
    case "EXECUTING":
      return "EXECUTING";
    case "PENDING":
      return "SUBMITTED";
  }
}

/** Attempt deadline: startedAt + time limit (plus a small network grace). */
export const SUBMIT_GRACE_MS = 30_000;

export function attemptEndsAt(startedAt: Date | null, timeLimitMinutes: number): Date | null {
  if (!startedAt) return null;
  return new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
}

export function isAttemptExpired(
  startedAt: Date | null,
  timeLimitMinutes: number,
  now: Date,
  graceMs = SUBMIT_GRACE_MS,
): boolean {
  const end = attemptEndsAt(startedAt, timeLimitMinutes);
  return end !== null && now.getTime() > end.getTime() + graceMs;
}
