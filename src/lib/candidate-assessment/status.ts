/**
 * V3.1 — candidate assessment status, derived from existing component records.
 *
 * Pure. Component and overall states describe progress only; there is no
 * PASS / FAIL / HIRE / REJECT concept here and nothing is persisted.
 */

export const COMPONENT_KEYS = ["AI_INTERVIEW", "CODING", "SQL"] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];

export const COMPONENT_STATES = [
  "NOT_ASSIGNED",
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

export const OVERALL_STATES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "PARTIALLY_COMPLETED"] as const;
export type OverallState = (typeof OVERALL_STATES)[number];

export type InterviewRecord = {
  id: string;
  status: string;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  blueprintLinked: boolean;
};

export type PracticalRecord = {
  id: string;
  type: "CODING" | "SQL";
  status: string;
  tokenExpiresAt: Date;
  createdAt: Date;
  hasSubmission: boolean;
  /** V3 provenance: the runtime matches the blueprint's recommended practical. */
  runtimeMatchesRecommendation: boolean;
};

export function interviewComponentState(row: InterviewRecord, now: Date): ComponentState {
  switch (row.status) {
    case "SCHEDULED":
      return row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= now.getTime() ? "EXPIRED" : "NOT_STARTED";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
    case "NO_SHOW":
      return "EXPIRED";
    // Ended early by the existing interview integrity policy — reflected, never re-judged here.
    case "TERMINATED":
      return "FAILED";
    default:
      return "NOT_STARTED";
  }
}

export function practicalComponentState(row: PracticalRecord, now: Date): ComponentState {
  switch (row.status) {
    case "NOT_STARTED":
      return row.tokenExpiresAt.getTime() <= now.getTime() ? "EXPIRED" : "NOT_STARTED";
    case "STARTED":
    case "IN_PROGRESS":
    case "SUBMITTED":
    case "EXECUTING":
      return "IN_PROGRESS";
    case "COMPLETED":
      return "COMPLETED";
    case "EXECUTION_FAILED":
      return "FAILED";
    // TIMEOUT with a submission = the frozen code ran and hit its time limit (recorded evidence);
    // without one = the attempt window closed before submission.
    case "TIMEOUT":
      return row.hasSubmission ? "COMPLETED" : "EXPIRED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "NOT_STARTED";
  }
}

const ACTIVE_INTERVIEW = new Set(["SCHEDULED", "IN_PROGRESS"]);
const ACTIVE_PRACTICAL = new Set(["NOT_STARTED", "STARTED", "IN_PROGRESS", "SUBMITTED", "EXECUTING"]);

function newest<T extends { createdAt: Date }>(rows: T[]): T | null {
  return rows.reduce<T | null>((best, r) => (!best || r.createdAt.getTime() > best.createdAt.getTime() ? r : best), null);
}

/** The interview that represents the assessment: an active one first, blueprint-linked preferred, else the newest. */
export function pickInterview(rows: InterviewRecord[]): InterviewRecord | null {
  const active = rows.filter((r) => ACTIVE_INTERVIEW.has(r.status));
  return (
    newest(active.filter((r) => r.blueprintLinked)) ??
    newest(active) ??
    newest(rows.filter((r) => r.blueprintLinked && r.status !== "CANCELLED")) ??
    newest(rows.filter((r) => r.status !== "CANCELLED")) ??
    newest(rows)
  );
}

/** The practical of one runtime that represents the assessment: the open one, else the newest non-cancelled, else newest. */
export function pickPractical(rows: PracticalRecord[], type: "CODING" | "SQL"): PracticalRecord | null {
  const ofType = rows.filter((r) => r.type === type);
  return (
    newest(ofType.filter((r) => ACTIVE_PRACTICAL.has(r.status))) ??
    newest(ofType.filter((r) => r.status !== "CANCELLED")) ??
    newest(ofType)
  );
}

export type ComponentStatus = {
  key: ComponentKey;
  state: ComponentState;
  /** Server rule: AI interview and the blueprint-recommended practical are required; the other practical is optional. */
  required: boolean;
  sourceId: string | null;
};

export function buildComponents(params: {
  interviews: InterviewRecord[];
  practicals: PracticalRecord[];
  now: Date;
}): ComponentStatus[] {
  const interview = pickInterview(params.interviews);
  const coding = pickPractical(params.practicals, "CODING");
  const sql = pickPractical(params.practicals, "SQL");
  const practical = (key: "CODING" | "SQL", row: PracticalRecord | null): ComponentStatus =>
    row
      ? {
          key,
          state: practicalComponentState(row, params.now),
          required: row.runtimeMatchesRecommendation,
          sourceId: row.id,
        }
      : { key, state: "NOT_ASSIGNED", required: false, sourceId: null };
  return [
    interview
      ? { key: "AI_INTERVIEW", state: interviewComponentState(interview, params.now), required: true, sourceId: interview.id }
      : { key: "AI_INTERVIEW", state: "NOT_ASSIGNED", required: true, sourceId: null },
    practical("CODING", coding),
    practical("SQL", sql),
  ];
}

const TERMINAL: ReadonlySet<ComponentState> = new Set<ComponentState>(["COMPLETED", "FAILED", "EXPIRED"]);

/** Components that count toward the assessment: assigned and not cancelled. */
export function countedComponents(components: ComponentStatus[]): ComponentStatus[] {
  return components.filter((c) => c.state !== "NOT_ASSIGNED" && c.state !== "CANCELLED");
}

export function overallState(components: ComponentStatus[]): OverallState {
  const counted = countedComponents(components);
  if (counted.length === 0) return "NOT_STARTED";
  const required = counted.filter((c) => c.required);
  const gate = required.length > 0 ? required : counted;
  if (gate.every((c) => c.state === "COMPLETED")) return "COMPLETED";
  if (gate.every((c) => TERMINAL.has(c.state))) return "PARTIALLY_COMPLETED";
  if (counted.every((c) => c.state === "NOT_STARTED")) return "NOT_STARTED";
  return "IN_PROGRESS";
}

export function progressOf(components: ComponentStatus[]): {
  completed: number;
  total: number;
  requiredCompleted: number;
  requiredTotal: number;
} {
  const counted = countedComponents(components);
  const required = counted.filter((c) => c.required);
  return {
    completed: counted.filter((c) => c.state === "COMPLETED").length,
    total: counted.length,
    requiredCompleted: required.filter((c) => c.state === "COMPLETED").length,
    requiredTotal: required.length,
  };
}

/** Stable identity of the component set, so "assessment_completed" is audited once per set. */
export function completionSignature(components: ComponentStatus[]): string {
  return countedComponents(components)
    .map((c) => `${c.key}:${c.sourceId ?? "-"}`)
    .sort()
    .join("|");
}
