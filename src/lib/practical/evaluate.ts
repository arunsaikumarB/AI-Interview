import type {
  CodingResult,
  CodingTask,
  CodingTestCase,
  CodingTestResult,
  ResourceViolation,
  SqlCell,
  SqlMismatch,
  SqlResult,
  SqlTask,
  TestOutcome,
} from "./types";

/**
 * Deterministic evaluation of runner output against server-held expectations.
 * No AI, no heuristics about "quality" — only measured, reproducible evidence.
 */

// -----------------------------------------------------------------------------
// Runner response shapes (validated defensively — the runner is trusted but
// candidate stdout inside it is not)
// -----------------------------------------------------------------------------

export type RunnerTestOutput = {
  id: string;
  outcome: "OK" | "RUNTIME_ERROR" | "TIMEOUT" | "OUTPUT_LIMIT" | "MEMORY_LIMIT" | "PROCESS_LIMIT";
  stdout: string;
  stderrTail: string;
  runtimeMs: number | null;
};

export type RunnerCodeResponse =
  | { status: "OK"; tests: RunnerTestOutput[]; memoryMb: number | null; runnerVersion?: string }
  | { status: "COMPILE_ERROR"; compileError: string; runnerVersion?: string }
  | { status: "TIMEOUT" | "INFRA_ERROR"; runnerVersion?: string }
  | { status: "RESOURCE_VIOLATION"; violation: "MEMORY" | "OUTPUT"; runnerVersion?: string };

export type RunnerSqlResponse =
  | {
      status: "OK" | "ROW_LIMIT";
      columns: { name: string; type: "number" | "text" | "bool" }[];
      rows: (string | boolean | null)[][];
      rowLimitExceeded: boolean;
      resultTruncated: boolean;
      runtimeMs: number;
      runnerVersion?: string;
    }
  | { status: "SQL_ERROR"; sqlState: string; error: string; runtimeMs: number; runnerVersion?: string }
  | { status: "TIMEOUT"; runtimeMs: number; runnerVersion?: string }
  | { status: "INFRA_ERROR"; runnerVersion?: string };

// -----------------------------------------------------------------------------
// Coding
// -----------------------------------------------------------------------------

/** CRLF → LF, strip trailing whitespace per line, drop trailing blank lines. */
export function normalizeOutput(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

function outcomeFor(out: RunnerTestOutput | undefined, expected: string): TestOutcome {
  if (!out) return "NOT_RUN";
  switch (out.outcome) {
    case "OK":
      return outputsMatch(out.stdout, expected) ? "PASSED" : "WRONG_OUTPUT";
    case "TIMEOUT":
      return "TIMEOUT";
    case "OUTPUT_LIMIT":
      return "OUTPUT_LIMIT";
    case "MEMORY_LIMIT":
      return "MEMORY_LIMIT";
    default:
      return "RUNTIME_ERROR";
  }
}

export type EvaluatedCodingRun = {
  result: CodingResult;
  /** Candidate-safe detail for visible tests only (their input/expected are public). */
  visibleDetail: { id: string; name: string; outcome: TestOutcome; stdout: string; stderrTail: string; runtimeMs: number | null }[];
  compileErrorMessage: string | null;
};

export function evaluateCodingRun(
  task: CodingTask,
  tests: { case: CodingTestCase; visible: boolean }[],
  response: RunnerCodeResponse,
): EvaluatedCodingRun {
  const total = tests.length;
  const base = {
    kind: "CODING" as const,
    total,
    memoryMb: null as number | null,
    runtimeMs: null as number | null,
  };
  const notRun = (outcome: TestOutcome): CodingTestResult[] =>
    tests.map((t) => ({ id: t.case.id, name: t.case.name, visible: t.visible, outcome, runtimeMs: null }));

  if (response.status === "COMPILE_ERROR") {
    return {
      result: {
        ...base,
        status: "COMPILE_ERROR",
        passed: 0,
        failed: total,
        compileError: true,
        timedOut: false,
        resourceViolation: null,
        tests: notRun("NOT_RUN"),
      },
      visibleDetail: [],
      compileErrorMessage: String(response.compileError ?? "").slice(0, 2000),
    };
  }
  if (response.status !== "OK") {
    const status =
      response.status === "TIMEOUT" ? "TIMEOUT" : response.status === "RESOURCE_VIOLATION" ? "RESOURCE_VIOLATION" : "EXECUTION_FAILED";
    const violation: ResourceViolation =
      response.status === "RESOURCE_VIOLATION" ? (response.violation === "OUTPUT" ? "OUTPUT" : "MEMORY") : null;
    return {
      result: {
        ...base,
        status,
        passed: 0,
        failed: total,
        compileError: false,
        timedOut: response.status === "TIMEOUT",
        resourceViolation: violation,
        tests: notRun(response.status === "TIMEOUT" ? "TIMEOUT" : "NOT_RUN"),
      },
      visibleDetail: [],
      compileErrorMessage: null,
    };
  }

  const byId = new Map(response.tests.map((t) => [t.id, t]));
  let runtime = 0;
  let violation: ResourceViolation = null;
  const results: CodingTestResult[] = [];
  const visibleDetail: EvaluatedCodingRun["visibleDetail"] = [];
  for (const t of tests) {
    const out = byId.get(t.case.id);
    const outcome = outcomeFor(out, t.case.expected);
    if (out?.outcome === "MEMORY_LIMIT") violation = "MEMORY";
    else if (out?.outcome === "OUTPUT_LIMIT" && violation === null) violation = "OUTPUT";
    else if (out?.outcome === "PROCESS_LIMIT" && violation === null) violation = "PROCESS";
    const ms = typeof out?.runtimeMs === "number" ? out.runtimeMs : null;
    if (ms !== null) runtime += ms;
    results.push({ id: t.case.id, name: t.case.name, visible: t.visible, outcome, runtimeMs: ms });
    if (t.visible) {
      visibleDetail.push({
        id: t.case.id,
        name: t.case.name,
        outcome,
        stdout: (out?.stdout ?? "").slice(0, 4000),
        stderrTail: (out?.stderrTail ?? "").slice(0, 1000),
        runtimeMs: ms,
      });
    }
  }
  const passed = results.filter((r) => r.outcome === "PASSED").length;
  return {
    result: {
      ...base,
      status: "COMPLETED",
      passed,
      failed: total - passed,
      runtimeMs: runtime,
      memoryMb: typeof response.memoryMb === "number" ? response.memoryMb : null,
      compileError: false,
      timedOut: results.some((r) => r.outcome === "TIMEOUT"),
      resourceViolation: violation,
      tests: results,
    },
    visibleDetail,
    compileErrorMessage: null,
  };
}

// -----------------------------------------------------------------------------
// SQL — compare result datasets, never SQL text
// -----------------------------------------------------------------------------

type ColumnKind = "number" | "bool" | "text";

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Column kinds come from the expected result, so numeric normalisation never applies to text columns. */
function columnKinds(expected: SqlCell[][], width: number): ColumnKind[] {
  return Array.from({ length: width }, (_, i) => {
    const values = expected.map((r) => r[i]).filter((v) => v !== null && v !== undefined);
    if (values.length && values.every((v) => typeof v === "number")) return "number";
    if (values.length && values.every((v) => typeof v === "boolean")) return "bool";
    return "text";
  });
}

function canonicalCell(cell: SqlCell | undefined, kind: ColumnKind, scale: number): string {
  if (cell === null || cell === undefined) return "\u0000NULL";
  if (kind === "number") {
    const n = typeof cell === "number" ? cell : typeof cell === "string" && NUMERIC_TEXT.test(cell.trim()) ? Number(cell) : NaN;
    return Number.isFinite(n) ? `\u0000NUM:${n.toFixed(scale)}` : `\u0000RAW:${String(cell)}`;
  }
  if (kind === "bool") {
    return typeof cell === "boolean" ? (cell ? "\u0000TRUE" : "\u0000FALSE") : `\u0000RAW:${String(cell)}`;
  }
  return `S:${String(cell)}`;
}

function canonicalRow(row: SqlCell[], kinds: ColumnKind[], scale: number): string {
  return JSON.stringify(kinds.map((k, i) => canonicalCell(row[i], k, scale)));
}

export function compareSqlDatasets(
  expected: { columns: string[]; rows: SqlCell[][] },
  actual: { columns: string[]; rows: SqlCell[][] },
  comparison: SqlTask["comparison"],
): { correct: boolean; mismatch: SqlMismatch } {
  if (expected.columns.length !== actual.columns.length) return { correct: false, mismatch: "COLUMN_COUNT" };
  if (
    comparison.checkColumnNames &&
    expected.columns.some((c, i) => c.toLowerCase() !== (actual.columns[i] ?? "").toLowerCase())
  ) {
    return { correct: false, mismatch: "COLUMN_NAMES" };
  }
  if (expected.rows.length !== actual.rows.length) return { correct: false, mismatch: "ROW_COUNT" };

  const kinds = columnKinds(expected.rows, expected.columns.length);
  const exp = expected.rows.map((r) => canonicalRow(r, kinds, comparison.numericScale));
  const act = actual.rows.map((r) => canonicalRow(r, kinds, comparison.numericScale));

  const counts = new Map<string, number>();
  for (const r of exp) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const r of act) {
    const n = counts.get(r) ?? 0;
    if (n === 0) return { correct: false, mismatch: "VALUES" };
    counts.set(r, n - 1);
  }
  if (comparison.orderMatters && exp.some((r, i) => r !== act[i])) return { correct: false, mismatch: "ORDER" };
  return { correct: true, mismatch: null };
}

export function evaluateSqlSubmission(task: SqlTask, response: RunnerSqlResponse): SqlResult {
  const base = {
    kind: "SQL" as const,
    total: 1,
    rowCount: null as number | null,
    columnCount: null as number | null,
    timedOut: false,
    rowLimitExceeded: false,
    mismatch: null as SqlMismatch,
  };
  switch (response.status) {
    case "OK": {
      const cmp = compareSqlDatasets(
        task.expectedResult,
        { columns: response.columns.map((c) => c.name), rows: response.rows },
        task.comparison,
      );
      return {
        ...base,
        status: "COMPLETED",
        correct: cmp.correct,
        passed: cmp.correct ? 1 : 0,
        failed: cmp.correct ? 0 : 1,
        runtimeMs: response.runtimeMs,
        rowCount: response.rows.length,
        columnCount: response.columns.length,
        mismatch: cmp.mismatch,
      };
    }
    case "ROW_LIMIT":
      return {
        ...base,
        status: "ROW_LIMIT",
        correct: false,
        passed: 0,
        failed: 1,
        runtimeMs: response.runtimeMs,
        rowCount: response.rows.length,
        columnCount: response.columns.length,
        rowLimitExceeded: true,
        mismatch: "ROW_COUNT",
      };
    case "SQL_ERROR":
      return { ...base, status: "SQL_ERROR", correct: false, passed: 0, failed: 1, runtimeMs: response.runtimeMs };
    case "TIMEOUT":
      return { ...base, status: "TIMEOUT", correct: false, passed: 0, failed: 1, runtimeMs: response.runtimeMs, timedOut: true };
    default:
      return { ...base, status: "EXECUTION_FAILED", correct: false, passed: 0, failed: 1, runtimeMs: null };
  }
}
