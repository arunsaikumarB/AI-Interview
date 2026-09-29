import type { Prisma, PracticalExecStatus, PracticalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgScopeWhere } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { AssessmentEngineService } from "@/lib/assessment/service";
import { loadBlueprintSources } from "@/lib/assessment/load";
import {
  evaluateCodingRun,
  evaluateSqlSubmission,
  type RunnerCodeResponse,
  type RunnerSqlResponse,
} from "./evaluate";
import { assessmentStatusForExec, attemptEndsAt, isAttemptExpired, isEditable, type ExecStatusValue } from "./lifecycle";
import { callRunner, callRunnerWithRetry, type RunnerFailure } from "./runner-client";
import { selectPracticalTask } from "./select";
import { candidateTaskView, getPracticalTask } from "./tasks";
import { ACCESS_TOKEN_RE, derivePracticalToken, hashAccessToken, newAccessToken, sha256Hex } from "./token";
import {
  CodingRunInputSchema,
  DraftInputSchema,
  LANGUAGE_LABELS,
  PRACTICAL_RUNTIME_VERSION,
  SQL_LANGUAGE,
  SqlRunInputSchema,
  utf8Bytes,
  type CandidateTaskView,
  type CodingTask,
  type PracticalKind,
  type PracticalResult,
  type PracticalTask,
  type SqlCell,
  type SqlTask,
  type TestOutcome,
} from "./types";

/**
 * V3.0 practical assessment service. Evidence only: nothing here changes an
 * application stage, creates an AIEvaluation, calls an LLM or reads proctoring.
 * Execution always happens in the separate sandbox runner — never in Next.js.
 */

export const LINK_VALID_DAYS = 7;
/** An execution that has not finished after this long is recorded as abandoned (server restart / crash). */
export const EXECUTION_STALE_MS = 10 * 60_000;
const RUN_TIMEOUT_MS = 75_000;
const SUBMIT_TIMEOUT_MS = 90_000;
const CANDIDATE_MAX_ROWS = 200;

const ACTIVE_STATUSES: PracticalStatus[] = ["NOT_STARTED", "STARTED", "IN_PROGRESS", "SUBMITTED", "EXECUTING"];
const EDITABLE_STATUSES: PracticalStatus[] = ["STARTED", "IN_PROGRESS"];

export type PracticalErrorCode =
  | "NOT_FOUND"
  | "LINK_EXPIRED"
  | "INVALID_STATE"
  | "ATTEMPT_EXPIRED"
  | "LANGUAGE_NOT_ALLOWED"
  | "INVALID_INPUT"
  | "ALREADY_ACTIVE"
  | "NO_TASK"
  | "RUN_IN_PROGRESS"
  | "RUNNER_UNAVAILABLE";

export class PracticalError extends Error {
  constructor(
    readonly code: PracticalErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PracticalError";
  }
}

const notFound = () => new PracticalError("NOT_FOUND", 404, "Assessment not found");

// -----------------------------------------------------------------------------
// Audit (TimelineEvent OTHER — never AI_EVALUATION, never test contents or source)
// -----------------------------------------------------------------------------

export type PracticalAuditKind =
  | "practical_assessment_assigned"
  | "practical_assessment_started"
  | "practical_assessment_submitted"
  | "practical_assessment_completed"
  | "practical_assessment_failed"
  | "practical_assessment_cancelled";

export function practicalAuditPayload(
  kind: PracticalAuditKind,
  fields: Record<string, string | number | boolean | null>,
): Prisma.InputJsonObject {
  return {
    ...fields,
    kind,
    advisoryOnly: true,
    noAtsStageChange: true,
    noAiInput: true,
    evidenceOnly: true,
  };
}

type Tx = Prisma.TransactionClient;

async function audit(
  db: Tx | typeof prisma,
  applicationId: string,
  kind: PracticalAuditKind,
  fields: Record<string, string | number | boolean | null>,
) {
  await db.timelineEvent.create({
    data: { applicationId, type: "OTHER", payload: practicalAuditPayload(kind, fields) },
  });
}

// -----------------------------------------------------------------------------
// In-flight guard (one run / submit per assessment at a time, per server process)
// -----------------------------------------------------------------------------

const inflightStore = globalThis as unknown as { __hireosPracticalInflight?: Set<string> };
function inflight(): Set<string> {
  inflightStore.__hireosPracticalInflight ??= new Set<string>();
  return inflightStore.__hireosPracticalInflight;
}

async function withInflight<T>(assessmentId: string, fn: () => Promise<T>): Promise<T> {
  const set = inflight();
  if (set.has(assessmentId)) throw new PracticalError("RUN_IN_PROGRESS", 429, "A run is already in progress");
  set.add(assessmentId);
  try {
    return await fn();
  } finally {
    set.delete(assessmentId);
  }
}

// -----------------------------------------------------------------------------
// Staff
// -----------------------------------------------------------------------------

function taskFor(row: { taskKey: string; taskVersion: number }): PracticalTask | null {
  return getPracticalTask(row.taskKey, row.taskVersion);
}

export type StaffPracticalSummary = {
  id: string;
  type: PracticalKind;
  title: string;
  taskKey: string;
  taskVersion: number;
  competency: string;
  difficulty: string;
  status: PracticalStatus;
  timeLimitMinutes: number;
  tokenExpiresAt: string;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  evidence: {
    execStatus: PracticalExecStatus;
    passed: number | null;
    total: number | null;
    runtimeMs: number | null;
  } | null;
};

const summarySelect = {
  id: true,
  type: true,
  taskKey: true,
  taskVersion: true,
  competency: true,
  difficulty: true,
  status: true,
  timeLimitMinutes: true,
  tokenExpiresAt: true,
  startedAt: true,
  submittedAt: true,
  completedAt: true,
  createdAt: true,
  submission: { select: { execStatus: true, result: true } },
} satisfies Prisma.PracticalAssessmentSelect;

type SummaryRow = Prisma.PracticalAssessmentGetPayload<{ select: typeof summarySelect }>;

function resultNumbers(result: unknown): { passed: number | null; total: number | null; runtimeMs: number | null } {
  if (!result || typeof result !== "object") return { passed: null, total: null, runtimeMs: null };
  const r = result as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { passed: num(r.passed), total: num(r.total), runtimeMs: num(r.runtimeMs) };
}

function toSummary(row: SummaryRow): StaffPracticalSummary {
  const task = taskFor(row);
  return {
    id: row.id,
    type: row.type,
    title: task?.title ?? row.taskKey,
    taskKey: row.taskKey,
    taskVersion: row.taskVersion,
    competency: row.competency,
    difficulty: row.difficulty,
    status: row.status,
    timeLimitMinutes: row.timeLimitMinutes,
    tokenExpiresAt: row.tokenExpiresAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    evidence: row.submission
      ? { execStatus: row.submission.execStatus, ...resultNumbers(row.submission.result) }
      : null,
  };
}

async function findScopedApplication(user: SessionUser, applicationId: string) {
  return prisma.application.findFirst({
    where: { id: applicationId, job: orgScopeWhere(user) },
    select: { id: true, jobId: true },
  });
}

export async function assignPracticalAssessment(
  user: SessionUser,
  applicationId: string,
  type: PracticalKind,
  now = new Date(),
): Promise<{ assessment: StaffPracticalSummary; candidatePath: string }> {
  const app = await findScopedApplication(user, applicationId);
  if (!app) throw new PracticalError("NOT_FOUND", 404, "Application not found");

  const active = await prisma.practicalAssessment.count({
    where: { applicationId: app.id, type, status: { in: ACTIVE_STATUSES } },
  });
  if (active > 0) {
    throw new PracticalError("ALREADY_ACTIVE", 409, "An assessment of this type is already open for this application");
  }

  const sources = await loadBlueprintSources(user, app.jobId, app.id);
  if (sources.kind !== "OK") throw new PracticalError("NOT_FOUND", 404, "Application not found");
  const blueprint = AssessmentEngineService.buildBlueprint({ job: sources.job, candidate: sources.candidate, now });
  const selection = selectPracticalTask(blueprint, type);
  if (!selection.ok) {
    const message =
      selection.reason === "NO_MATCHING_COMPETENCY"
        ? `The job's assessment blueprint has no competency that a ${type === "SQL" ? "SQL" : "coding"} task can evidence`
        : "No practical task is available for this application";
    throw new PracticalError("NO_TASK", 422, message);
  }

  const task = selection.task;
  let token = "";
  const row = await prisma.$transaction(async (tx) => {
    // The derived token needs the row id, so the row is created under an unguessable placeholder hash first.
    const placeholder = await tx.practicalAssessment.create({
      data: {
        applicationId: app.id,
        type,
        taskKey: task.key,
        taskVersion: task.version,
        competency: selection.competency,
        difficulty: selection.difficulty,
        provenance: selection.provenance as unknown as Prisma.InputJsonObject,
        accessTokenHash: newAccessToken().hash,
        tokenExpiresAt: new Date(now.getTime() + LINK_VALID_DAYS * 86_400_000),
        timeLimitMinutes: task.timeLimitMinutes,
        createdById: user.id,
      },
      select: { id: true },
    });
    token = derivePracticalToken(placeholder.id);
    const created = await tx.practicalAssessment.update({
      where: { id: placeholder.id },
      data: { accessTokenHash: hashAccessToken(token) },
      select: summarySelect,
    });
    await audit(tx, app.id, "practical_assessment_assigned", {
      assessmentId: created.id,
      type,
      taskKey: task.key,
      taskVersion: task.version,
      difficulty: selection.difficulty,
      actorId: user.id,
    });
    return created;
  });

  return { assessment: toSummary(row), candidatePath: `/practical/${token}` };
}

/** Honest failure for executions that can no longer finish (e.g. the server restarted mid-run). */
async function recoverStale(rows: { id: string; applicationId: string; status: PracticalStatus; submittedAt: Date | null }[], now: Date) {
  for (const row of rows) {
    if (row.status !== "SUBMITTED" && row.status !== "EXECUTING") continue;
    if (!row.submittedAt || now.getTime() - row.submittedAt.getTime() < EXECUTION_STALE_MS) continue;
    const updated = await prisma.practicalAssessment.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: "EXECUTION_FAILED", completedAt: now },
    });
    if (updated.count === 0) continue;
    await prisma.practicalSubmission.updateMany({
      where: { assessmentId: row.id, execStatus: { in: ["PENDING", "EXECUTING"] } },
      data: {
        execStatus: "EXECUTION_FAILED",
        executedAt: now,
        result: { kind: "INFRASTRUCTURE", status: "EXECUTION_FAILED", reason: "EXECUTION_ABANDONED", attempts: null },
      },
    });
    await audit(prisma, row.applicationId, "practical_assessment_failed", {
      assessmentId: row.id,
      reason: "EXECUTION_ABANDONED",
    });
  }
}

export async function listPracticalAssessments(user: SessionUser, applicationId: string, now = new Date()) {
  const app = await findScopedApplication(user, applicationId);
  if (!app) throw new PracticalError("NOT_FOUND", 404, "Application not found");
  const stale = await prisma.practicalAssessment.findMany({
    where: { applicationId: app.id, status: { in: ["SUBMITTED", "EXECUTING"] } },
    select: { id: true, applicationId: true, status: true, submittedAt: true },
  });
  await recoverStale(stale, now);
  const rows = await prisma.practicalAssessment.findMany({
    where: { applicationId: app.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: summarySelect,
  });
  return rows.map(toSummary);
}

export type StaffPracticalDetail = StaffPracticalSummary & {
  provenance: unknown;
  instructions: string;
  submission: {
    id: string;
    language: string;
    languageLabel: string;
    source: string;
    sourceSha256: string;
    sizeBytes: number;
    taskVersion: number;
    runnerVersion: string;
    execStatus: PracticalExecStatus;
    result: unknown;
    submittedAt: string;
    executedAt: string | null;
  } | null;
};

export async function getPracticalDetail(user: SessionUser, id: string, now = new Date()): Promise<StaffPracticalDetail> {
  const scoped = await prisma.practicalAssessment.findFirst({
    where: { id, application: { job: orgScopeWhere(user) } },
    select: { id: true, applicationId: true, status: true, submittedAt: true },
  });
  if (!scoped) throw notFound();
  await recoverStale([scoped], now);
  const row = await prisma.practicalAssessment.findUniqueOrThrow({
    where: { id: scoped.id },
    select: {
      ...summarySelect,
      provenance: true,
      submission: {
        select: {
          id: true,
          language: true,
          source: true,
          sourceSha256: true,
          sizeBytes: true,
          taskVersion: true,
          runnerVersion: true,
          execStatus: true,
          result: true,
          submittedAt: true,
          executedAt: true,
        },
      },
    },
  });
  const task = taskFor(row);
  const sub = row.submission;
  return {
    ...toSummary(row),
    provenance: row.provenance,
    instructions: task?.instructions ?? "",
    submission: sub
      ? {
          id: sub.id,
          language: sub.language,
          languageLabel: LANGUAGE_LABELS[sub.language as keyof typeof LANGUAGE_LABELS] ?? sub.language,
          source: sub.source,
          sourceSha256: sub.sourceSha256,
          sizeBytes: sub.sizeBytes,
          taskVersion: sub.taskVersion,
          runnerVersion: sub.runnerVersion,
          execStatus: sub.execStatus,
          result: sub.result,
          submittedAt: sub.submittedAt.toISOString(),
          executedAt: sub.executedAt?.toISOString() ?? null,
        }
      : null,
  };
}

export async function cancelPracticalAssessment(user: SessionUser, id: string, now = new Date()) {
  const row = await prisma.practicalAssessment.findFirst({
    where: { id, application: { job: orgScopeWhere(user) } },
    select: { id: true, applicationId: true, status: true },
  });
  if (!row) throw notFound();
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.practicalAssessment.updateMany({
      where: { id: row.id, status: { in: ["NOT_STARTED", "STARTED", "IN_PROGRESS"] } },
      data: { status: "CANCELLED", completedAt: now },
    });
    if (res.count > 0) {
      await audit(tx, row.applicationId, "practical_assessment_cancelled", { assessmentId: row.id, actorId: user.id });
    }
    return res.count;
  });
  if (updated === 0) throw new PracticalError("INVALID_STATE", 409, "Only an assessment that has not been submitted can be cancelled");
  return { id: row.id, status: "CANCELLED" as const };
}

// -----------------------------------------------------------------------------
// Candidate (magic-link token)
// -----------------------------------------------------------------------------

const candidateSelect = {
  id: true,
  applicationId: true,
  type: true,
  taskKey: true,
  taskVersion: true,
  status: true,
  tokenExpiresAt: true,
  timeLimitMinutes: true,
  startedAt: true,
  submittedAt: true,
  draftLanguage: true,
  draftSource: true,
} satisfies Prisma.PracticalAssessmentSelect;

type CandidateRow = Prisma.PracticalAssessmentGetPayload<{ select: typeof candidateSelect }>;

async function loadByToken(token: string): Promise<CandidateRow> {
  if (!ACCESS_TOKEN_RE.test(token)) throw notFound();
  const row = await prisma.practicalAssessment.findUnique({
    where: { accessTokenHash: hashAccessToken(token) },
    select: candidateSelect,
  });
  if (!row) throw notFound();
  return row;
}

/** Lazily records an expired attempt. Returns the fresh status. */
async function expireIfNeeded(row: CandidateRow, now: Date): Promise<PracticalStatus> {
  if (!isEditable(row.status) || !isAttemptExpired(row.startedAt, row.timeLimitMinutes, now)) return row.status;
  const res = await prisma.practicalAssessment.updateMany({
    where: { id: row.id, status: { in: EDITABLE_STATUSES } },
    data: { status: "TIMEOUT", completedAt: now },
  });
  if (res.count > 0) {
    await audit(prisma, row.applicationId, "practical_assessment_failed", {
      assessmentId: row.id,
      reason: "ATTEMPT_TIME_EXPIRED",
    });
    return "TIMEOUT";
  }
  const fresh = await prisma.practicalAssessment.findUnique({ where: { id: row.id }, select: { status: true } });
  return fresh?.status ?? row.status;
}

function requireTask(row: CandidateRow): PracticalTask {
  const task = taskFor(row);
  if (!task || task.kind !== row.type) throw notFound();
  return task;
}

export type CandidatePracticalState = {
  type: PracticalKind;
  status: PracticalStatus;
  title: string;
  timeLimitMinutes: number;
  linkExpired: boolean;
  startedAt: string | null;
  endsAt: string | null;
  submittedAt: string | null;
  serverNow: string;
  task: CandidateTaskView | null;
  draft: { language: string; source: string } | null;
};

export async function getCandidateState(token: string, now = new Date()): Promise<CandidatePracticalState> {
  const row = await loadByToken(token);
  const task = requireTask(row);
  const status = await expireIfNeeded(row, now);
  const editable = isEditable(status);
  const endsAt = attemptEndsAt(row.startedAt, row.timeLimitMinutes);
  return {
    type: row.type,
    status,
    title: task.title,
    timeLimitMinutes: row.timeLimitMinutes,
    linkExpired: status === "NOT_STARTED" && row.tokenExpiresAt.getTime() < now.getTime(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    serverNow: now.toISOString(),
    task: editable ? candidateTaskView(task) : null,
    draft: editable && row.draftLanguage && row.draftSource !== null ? { language: row.draftLanguage, source: row.draftSource } : null,
  };
}

export async function startPracticalAssessment(token: string, now = new Date()) {
  const row = await loadByToken(token);
  requireTask(row);
  if (row.status !== "NOT_STARTED") throw new PracticalError("INVALID_STATE", 409, "This assessment has already been started");
  if (row.tokenExpiresAt.getTime() < now.getTime()) throw new PracticalError("LINK_EXPIRED", 410, "This assessment link has expired");
  const res = await prisma.$transaction(async (tx) => {
    const updated = await tx.practicalAssessment.updateMany({
      where: { id: row.id, status: "NOT_STARTED" },
      data: { status: "STARTED", startedAt: now },
    });
    if (updated.count > 0) {
      await audit(tx, row.applicationId, "practical_assessment_started", { assessmentId: row.id });
    }
    return updated.count;
  });
  if (res === 0) throw new PracticalError("INVALID_STATE", 409, "This assessment has already been started");
  return getCandidateState(token, now);
}

function languageAllowed(task: PracticalTask, language: string): boolean {
  if (task.kind === "SQL") return language === SQL_LANGUAGE;
  return (task.languages as readonly string[]).includes(language);
}

async function requireOpenAttempt(token: string, now: Date): Promise<{ row: CandidateRow; task: PracticalTask }> {
  const row = await loadByToken(token);
  const task = requireTask(row);
  const status = await expireIfNeeded(row, now);
  if (status === "TIMEOUT" && isEditable(row.status)) {
    throw new PracticalError("ATTEMPT_EXPIRED", 409, "The time limit for this assessment has passed");
  }
  if (!isEditable(status)) throw new PracticalError("INVALID_STATE", 409, "This assessment is not open for editing");
  return { row, task };
}

/** Autosave: stores the draft only. Never executes, never submits. */
export async function saveDraft(token: string, input: unknown, now = new Date()) {
  const parsed = DraftInputSchema.safeParse(input);
  if (!parsed.success) throw new PracticalError("INVALID_INPUT", 400, "Invalid draft");
  const { row, task } = await requireOpenAttempt(token, now);
  if (!languageAllowed(task, parsed.data.language)) {
    throw new PracticalError("LANGUAGE_NOT_ALLOWED", 400, "Language not allowed for this assessment");
  }
  const res = await prisma.practicalAssessment.updateMany({
    where: { id: row.id, status: { in: EDITABLE_STATUSES } },
    data: {
      status: "IN_PROGRESS",
      draftLanguage: parsed.data.language,
      draftSource: parsed.data.source,
      draftSavedAt: now,
    },
  });
  if (res.count === 0) throw new PracticalError("INVALID_STATE", 409, "This assessment is not open for editing");
  return { savedAt: now.toISOString() };
}

function parseSource(task: PracticalTask, input: unknown): { language: string; source: string } {
  const schema = task.kind === "CODING" ? CodingRunInputSchema : SqlRunInputSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PracticalError("INVALID_INPUT", 400, "Invalid code or query");
  if (!languageAllowed(task, parsed.data.language)) {
    throw new PracticalError("LANGUAGE_NOT_ALLOWED", 400, "Language not allowed for this assessment");
  }
  return parsed.data;
}

function codingPayload(task: CodingTask, language: string, source: string, includeHidden: boolean) {
  const tests = [
    ...task.visibleTests.map((c) => ({ case: c, visible: true })),
    ...(includeHidden ? task.hiddenTests.map((c) => ({ case: c, visible: false })) : []),
  ];
  return {
    tests,
    payload: {
      language,
      source,
      tests: tests.map((t) => ({ id: t.case.id, input: t.case.input })),
      limits: { ...task.limits },
    },
  };
}

function sqlPayload(task: SqlTask, source: string) {
  return { taskKey: task.key, taskVersion: task.version, query: source, limits: { ...task.limits } };
}

function runnerUnavailable(error: RunnerFailure): PracticalError {
  return error === "BUSY"
    ? new PracticalError("RUNNER_UNAVAILABLE", 503, "The code runner is busy. Please try again in a moment.")
    : new PracticalError("RUNNER_UNAVAILABLE", 503, "The code runner is unavailable. Please try again shortly.");
}

export type CandidateCodingRun = {
  kind: "CODING";
  status: "COMPLETED" | "COMPILE_ERROR" | "TIMEOUT" | "RESOURCE_VIOLATION" | "EXECUTION_FAILED";
  compileError: string | null;
  passed: number;
  total: number;
  tests: { name: string; outcome: TestOutcome; stdout: string; stderr: string; runtimeMs: number | null }[];
};

export type CandidateSqlRun = {
  kind: "SQL";
  status: "OK" | "ROW_LIMIT" | "SQL_ERROR" | "TIMEOUT" | "EXECUTION_FAILED";
  columns: string[];
  rows: SqlCell[][];
  rowCount: number;
  truncated: boolean;
  error: string | null;
  runtimeMs: number | null;
};

/** Run: visible tests only (coding) or the query's result table (SQL). Nothing is stored. */
export async function runPractical(token: string, input: unknown, now = new Date()): Promise<CandidateCodingRun | CandidateSqlRun> {
  const { row, task } = await requireOpenAttempt(token, now);
  const { language, source } = parseSource(task, input);
  return withInflight(row.id, async () => {
    if (task.kind === "CODING") {
      const { tests, payload } = codingPayload(task, language, source, false);
      const res = await callRunner<RunnerCodeResponse>("/v1/code/execute", payload, { timeoutMs: RUN_TIMEOUT_MS });
      if (!res.ok) throw runnerUnavailable(res.error);
      const evaluated = evaluateCodingRun(task, tests, res.data);
      return {
        kind: "CODING",
        status: evaluated.result.status,
        compileError: evaluated.compileErrorMessage,
        passed: evaluated.result.passed,
        total: evaluated.result.total,
        tests: evaluated.visibleDetail.map((t) => ({
          name: t.name,
          outcome: t.outcome,
          stdout: t.stdout,
          stderr: t.stderrTail,
          runtimeMs: t.runtimeMs,
        })),
      };
    }
    const res = await callRunner<RunnerSqlResponse>("/v1/sql/execute", sqlPayload(task, source), { timeoutMs: RUN_TIMEOUT_MS });
    if (!res.ok) throw runnerUnavailable(res.error);
    const data = res.data;
    if (data.status === "OK" || data.status === "ROW_LIMIT") {
      return {
        kind: "SQL",
        status: data.status,
        columns: data.columns.map((c) => c.name),
        rows: data.rows.slice(0, CANDIDATE_MAX_ROWS),
        rowCount: data.rows.length,
        truncated: data.rows.length > CANDIDATE_MAX_ROWS || data.rowLimitExceeded || data.resultTruncated,
        error: null,
        runtimeMs: data.runtimeMs,
      };
    }
    if (data.status === "SQL_ERROR") {
      return { kind: "SQL", status: "SQL_ERROR", columns: [], rows: [], rowCount: 0, truncated: false, error: data.error, runtimeMs: data.runtimeMs };
    }
    if (data.status === "TIMEOUT") {
      return {
        kind: "SQL",
        status: "TIMEOUT",
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        error: "The query exceeded the time limit",
        runtimeMs: data.runtimeMs,
      };
    }
    return { kind: "SQL", status: "EXECUTION_FAILED", columns: [], rows: [], rowCount: 0, truncated: false, error: "The query could not be executed", runtimeMs: null };
  });
}

type ExecutionOutcome = { execStatus: Exclude<ExecStatusValue, "PENDING" | "EXECUTING">; result: Prisma.InputJsonObject; runnerVersion: string | null };

export function execStatusForResult(result: PracticalResult): ExecutionOutcome["execStatus"] {
  if (result.status === "EXECUTION_FAILED") return "EXECUTION_FAILED";
  if (result.status === "TIMEOUT") return "TIMEOUT";
  return "COMPLETED";
}

async function executeFrozen(task: PracticalTask, language: string, source: string): Promise<ExecutionOutcome> {
  if (task.kind === "CODING") {
    const { tests, payload } = codingPayload(task, language, source, true);
    const res = await callRunnerWithRetry<RunnerCodeResponse>("/v1/code/execute", payload, { timeoutMs: SUBMIT_TIMEOUT_MS });
    if (!res.ok) {
      return {
        execStatus: "EXECUTION_FAILED",
        result: { kind: "INFRASTRUCTURE", status: "EXECUTION_FAILED", reason: `RUNNER_${res.error}`, attempts: res.attempts },
        runnerVersion: null,
      };
    }
    const evaluated = evaluateCodingRun(task, tests, res.data);
    const result: Prisma.InputJsonObject = {
      ...evaluated.result,
      tests: evaluated.result.tests.map((t) => ({ ...t })),
      compileErrorMessage: evaluated.compileErrorMessage,
    };
    return { execStatus: execStatusForResult(evaluated.result), result, runnerVersion: res.data.runnerVersion ?? null };
  }
  const res = await callRunnerWithRetry<RunnerSqlResponse>("/v1/sql/execute", sqlPayload(task, source), { timeoutMs: SUBMIT_TIMEOUT_MS });
  if (!res.ok) {
    return {
      execStatus: "EXECUTION_FAILED",
      result: { kind: "INFRASTRUCTURE", status: "EXECUTION_FAILED", reason: `RUNNER_${res.error}`, attempts: res.attempts },
      runnerVersion: null,
    };
  }
  const evaluated = evaluateSqlSubmission(task, res.data);
  const result: Prisma.InputJsonObject = {
    ...evaluated,
    sqlState: res.data.status === "SQL_ERROR" ? res.data.sqlState : null,
    errorMessage: res.data.status === "SQL_ERROR" ? res.data.error : null,
  };
  return { execStatus: execStatusForResult(evaluated), result, runnerVersion: res.data.runnerVersion ?? null };
}

/** Executes a frozen submission exactly once and writes its result once. */
export async function executeSubmission(submissionId: string, now: () => Date = () => new Date()): Promise<void> {
  const sub = await prisma.practicalSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      language: true,
      source: true,
      execStatus: true,
      assessment: { select: { id: true, applicationId: true, type: true, taskKey: true, taskVersion: true, status: true } },
    },
  });
  if (!sub || sub.execStatus !== "PENDING" || sub.assessment.status !== "SUBMITTED") return;
  const a = sub.assessment;

  const claimed = await prisma.$transaction(async (tx) => {
    const s = await tx.practicalSubmission.updateMany({ where: { id: sub.id, execStatus: "PENDING" }, data: { execStatus: "EXECUTING" } });
    if (s.count === 0) return false;
    await tx.practicalAssessment.updateMany({ where: { id: a.id, status: "SUBMITTED" }, data: { status: "EXECUTING" } });
    return true;
  });
  if (!claimed) return;

  const task = taskFor(a);
  let outcome: ExecutionOutcome;
  if (!task || task.kind !== a.type) {
    outcome = {
      execStatus: "EXECUTION_FAILED",
      result: { kind: "INFRASTRUCTURE", status: "EXECUTION_FAILED", reason: "TASK_VERSION_UNAVAILABLE", attempts: 0 },
      runnerVersion: null,
    };
  } else {
    try {
      outcome = await executeFrozen(task, sub.language, sub.source);
    } catch (err) {
      console.error("[practical] execution error:", err instanceof Error ? err.name : "unknown");
      outcome = {
        execStatus: "EXECUTION_FAILED",
        result: { kind: "INFRASTRUCTURE", status: "EXECUTION_FAILED", reason: "EVALUATION_ERROR", attempts: null },
        runnerVersion: null,
      };
    }
  }

  const finishedAt = now();
  const finalStatus = assessmentStatusForExec(outcome.execStatus);
  await prisma.$transaction(async (tx) => {
    const s = await tx.practicalSubmission.updateMany({
      where: { id: sub.id, execStatus: "EXECUTING" },
      data: {
        execStatus: outcome.execStatus,
        result: outcome.result,
        executedAt: finishedAt,
        ...(outcome.runnerVersion ? { runnerVersion: `${PRACTICAL_RUNTIME_VERSION}+${outcome.runnerVersion}` } : {}),
      },
    });
    if (s.count === 0) return;
    await tx.practicalAssessment.updateMany({
      where: { id: a.id, status: "EXECUTING" },
      data: { status: finalStatus, completedAt: finishedAt },
    });
    const nums = resultNumbers(outcome.result);
    await audit(
      tx,
      a.applicationId,
      outcome.execStatus === "COMPLETED" ? "practical_assessment_completed" : "practical_assessment_failed",
      {
        assessmentId: a.id,
        submissionId: sub.id,
        type: a.type,
        execStatus: outcome.execStatus,
        passed: nums.passed,
        total: nums.total,
      },
    );
  });
}

export type SubmitOutcome = { submissionId: string; status: "SUBMITTED"; sourceSha256: string; submittedAt: string };

/**
 * Freezes the final answer (one immutable submission per assessment) and
 * schedules its execution. `schedule` defaults to background execution in this
 * process so the candidate is not held on a long request.
 */
export async function submitPractical(
  token: string,
  input: unknown,
  opts: { now?: Date; schedule?: (submissionId: string) => void } = {},
): Promise<SubmitOutcome> {
  const now = opts.now ?? new Date();
  const { row, task } = await requireOpenAttempt(token, now);
  const { language, source } = parseSource(task, input);
  const sourceSha256 = sha256Hex(source);

  const submissionId = await withInflight(row.id, () =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.practicalAssessment.updateMany({
        where: { id: row.id, status: { in: EDITABLE_STATUSES } },
        data: { status: "SUBMITTED", submittedAt: now, draftLanguage: language, draftSource: source, draftSavedAt: now },
      });
      if (updated.count === 0) throw new PracticalError("INVALID_STATE", 409, "This assessment has already been submitted");
      const created = await tx.practicalSubmission.create({
        data: {
          assessmentId: row.id,
          language,
          source,
          sourceSha256,
          sizeBytes: utf8Bytes(source),
          taskVersion: task.version,
          runnerVersion: PRACTICAL_RUNTIME_VERSION,
          submittedAt: now,
        },
        select: { id: true },
      });
      await audit(tx, row.applicationId, "practical_assessment_submitted", {
        assessmentId: row.id,
        submissionId: created.id,
        type: row.type,
        language,
        sourceSha256,
        sizeBytes: utf8Bytes(source),
      });
      return created.id;
    }),
  );

  const schedule =
    opts.schedule ??
    ((id: string) => {
      void executeSubmission(id).catch((err) =>
        console.error("[practical] background execution failed:", err instanceof Error ? err.name : "unknown"),
      );
    });
  schedule(submissionId);
  return { submissionId, status: "SUBMITTED", sourceSha256, submittedAt: now.toISOString() };
}
