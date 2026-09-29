import { z } from "zod";

/**
 * V3.0 practical assessment contracts (coding + SQL).
 *
 * Tasks, hidden tests, expected results and execution limits are server-side
 * only. Every schema that accepts browser input is strict, so a client that
 * tries to send hiddenTests / expectedResult / limits / competency is rejected.
 */

export const PRACTICAL_RUNTIME_VERSION = "practical-runtime-v3.0";

export const PRACTICAL_KINDS = ["CODING", "SQL"] as const;
export type PracticalKind = (typeof PRACTICAL_KINDS)[number];

export const CODING_LANGUAGES = ["python", "javascript"] as const;
export type CodingLanguage = (typeof CODING_LANGUAGES)[number];
export const SQL_LANGUAGE = "postgresql" as const;

export const LANGUAGE_LABELS: Record<CodingLanguage | typeof SQL_LANGUAGE, string> = {
  python: "Python 3.14",
  javascript: "JavaScript (Node.js 22)",
  postgresql: "PostgreSQL 16",
};

export const TASK_DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export type TaskDifficulty = (typeof TASK_DIFFICULTIES)[number];

// -----------------------------------------------------------------------------
// Limits (server authority — the browser can never widen them)
// -----------------------------------------------------------------------------

export type CodingLimits = {
  perTestTimeoutMs: number;
  memoryMb: number;
  maxOutputBytes: number;
};

export type SqlLimits = {
  timeoutMs: number;
  maxRows: number;
  maxResultBytes: number;
};

/** Hard ceilings applied on top of any task configuration (runner clamps again). */
export const CODING_HARD_LIMITS = {
  sourceMaxBytes: 32 * 1024,
  perTestTimeoutMs: 5000,
  memoryMb: 256,
  maxOutputBytes: 64 * 1024,
  maxTests: 20,
  testInputMaxBytes: 64 * 1024,
} as const;

export const SQL_HARD_LIMITS = {
  queryMaxBytes: 8 * 1024,
  timeoutMs: 5000,
  maxRows: 1000,
  maxResultBytes: 256 * 1024,
} as const;

export const DRAFT_MAX_BYTES = 64 * 1024;

// -----------------------------------------------------------------------------
// Task definitions (server-side library)
// -----------------------------------------------------------------------------

export type CodingTestCase = {
  id: string;
  name: string;
  input: string;
  expected: string;
};

export type CodingTask = {
  kind: "CODING";
  key: string;
  version: number;
  difficulty: TaskDifficulty;
  title: string;
  instructions: string;
  constraints: string[];
  languages: readonly CodingLanguage[];
  starterCode: Record<CodingLanguage, string>;
  visibleTests: CodingTestCase[];
  hiddenTests: CodingTestCase[];
  limits: CodingLimits;
  timeLimitMinutes: number;
};

export type SqlCell = string | number | boolean | null;

export type SqlTableSchema = {
  name: string;
  columns: { name: string; type: string; note?: string }[];
};

export type SqlSampleData = {
  table: string;
  columns: string[];
  rows: SqlCell[][];
};

export type SqlTask = {
  kind: "SQL";
  key: string;
  version: number;
  difficulty: TaskDifficulty;
  title: string;
  instructions: string;
  constraints: string[];
  /** Dataset loaded by the sandbox runner into this task's isolated database. */
  datasetKey: string;
  schema: SqlTableSchema[];
  sampleData: SqlSampleData[];
  starterQuery: string;
  expectedResult: { columns: string[]; rows: SqlCell[][] };
  comparison: {
    orderMatters: boolean;
    checkColumnNames: boolean;
    /** Decimal places used when both cells are numeric. */
    numericScale: number;
  };
  limits: SqlLimits;
  timeLimitMinutes: number;
};

export type PracticalTask = CodingTask | SqlTask;

// -----------------------------------------------------------------------------
// Candidate-facing task view (no hidden tests, no expected SQL result)
// -----------------------------------------------------------------------------

export type CandidateCodingTaskView = {
  kind: "CODING";
  title: string;
  instructions: string;
  constraints: string[];
  languages: { id: CodingLanguage; label: string }[];
  starterCode: Record<CodingLanguage, string>;
  examples: { name: string; input: string; expected: string }[];
  hiddenTestCount: number;
  limits: { perTestTimeoutMs: number; memoryMb: number; sourceMaxBytes: number };
};

export type CandidateSqlTaskView = {
  kind: "SQL";
  title: string;
  instructions: string;
  constraints: string[];
  language: { id: typeof SQL_LANGUAGE; label: string };
  schema: SqlTableSchema[];
  sampleData: SqlSampleData[];
  starterQuery: string;
  limits: { timeoutMs: number; maxRows: number; queryMaxBytes: number };
};

export type CandidateTaskView = CandidateCodingTaskView | CandidateSqlTaskView;

// -----------------------------------------------------------------------------
// Execution results (objective evidence only — no scores, no recommendations)
// -----------------------------------------------------------------------------

export const TEST_OUTCOMES = ["PASSED", "WRONG_OUTPUT", "RUNTIME_ERROR", "TIMEOUT", "OUTPUT_LIMIT", "MEMORY_LIMIT", "NOT_RUN"] as const;
export type TestOutcome = (typeof TEST_OUTCOMES)[number];

export type CodingTestResult = {
  id: string;
  name: string;
  visible: boolean;
  outcome: TestOutcome;
  runtimeMs: number | null;
};

export type ResourceViolation = "MEMORY" | "OUTPUT" | "PROCESS" | null;

export type CodingExecutionStatus = "COMPLETED" | "COMPILE_ERROR" | "TIMEOUT" | "RESOURCE_VIOLATION" | "EXECUTION_FAILED";

export type CodingResult = {
  kind: "CODING";
  status: CodingExecutionStatus;
  passed: number;
  failed: number;
  total: number;
  runtimeMs: number | null;
  memoryMb: number | null;
  compileError: boolean;
  timedOut: boolean;
  resourceViolation: ResourceViolation;
  tests: CodingTestResult[];
};

export type SqlExecutionStatus = "COMPLETED" | "SQL_ERROR" | "TIMEOUT" | "ROW_LIMIT" | "EXECUTION_FAILED";

export type SqlMismatch = "COLUMN_COUNT" | "COLUMN_NAMES" | "ROW_COUNT" | "VALUES" | "ORDER" | null;

export type SqlResult = {
  kind: "SQL";
  status: SqlExecutionStatus;
  correct: boolean;
  passed: number;
  failed: number;
  total: number;
  runtimeMs: number | null;
  rowCount: number | null;
  columnCount: number | null;
  timedOut: boolean;
  rowLimitExceeded: boolean;
  /** Staff-only diagnostic of *why* the dataset differed. Never shown to the candidate. */
  mismatch: SqlMismatch;
};

export type PracticalResult = CodingResult | SqlResult;

// -----------------------------------------------------------------------------
// Browser input schemas (strict)
// -----------------------------------------------------------------------------

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

const sourceText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .refine((s) => utf8Bytes(s) <= max, { message: `Must be at most ${max} bytes` })
    .refine((s) => !s.includes("\u0000"), { message: "NUL bytes are not allowed" });

export const CodingRunInputSchema = z
  .object({
    language: z.enum(CODING_LANGUAGES),
    source: sourceText(CODING_HARD_LIMITS.sourceMaxBytes).refine((s) => s.trim().length > 0, {
      message: "Source is empty",
    }),
  })
  .strict();

export const SqlRunInputSchema = z
  .object({
    language: z.literal(SQL_LANGUAGE),
    source: sourceText(SQL_HARD_LIMITS.queryMaxBytes).refine((s) => s.trim().length > 0, {
      message: "Query is empty",
    }),
  })
  .strict();

export const DraftInputSchema = z
  .object({
    language: z.union([z.enum(CODING_LANGUAGES), z.literal(SQL_LANGUAGE)]),
    source: sourceText(DRAFT_MAX_BYTES),
  })
  .strict();

export const AssignInputSchema = z
  .object({
    type: z.enum(PRACTICAL_KINDS),
  })
  .strict();

export type CodingRunInput = z.infer<typeof CodingRunInputSchema>;
export type SqlRunInput = z.infer<typeof SqlRunInputSchema>;
export type DraftInput = z.infer<typeof DraftInputSchema>;
