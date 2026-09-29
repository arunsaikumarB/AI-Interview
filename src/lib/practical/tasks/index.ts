import {
  CODING_HARD_LIMITS,
  LANGUAGE_LABELS,
  SQL_HARD_LIMITS,
  SQL_LANGUAGE,
  type CandidateTaskView,
  type CodingTask,
  type PracticalKind,
  type PracticalTask,
  type SqlTask,
  type TaskDifficulty,
} from "../types";
import { CODING_TASKS } from "./coding";
import { SQL_TASKS } from "./sql";

export { CODING_TASKS } from "./coding";
export { SQL_TASKS } from "./sql";

const ALL: readonly PracticalTask[] = [...CODING_TASKS, ...SQL_TASKS];

export function allPracticalTasks(): readonly PracticalTask[] {
  return ALL;
}

export function getPracticalTask(key: string, version: number): PracticalTask | null {
  return ALL.find((t) => t.key === key && t.version === version) ?? null;
}

const ORDER: TaskDifficulty[] = ["EASY", "MEDIUM", "HARD"];

/** Exact difficulty if available, otherwise the nearest easier, then harder task. */
export function pickTask(kind: PracticalKind, difficulty: TaskDifficulty): PracticalTask | null {
  const pool: readonly PracticalTask[] = kind === "CODING" ? CODING_TASKS : SQL_TASKS;
  const exact = pool.find((t) => t.difficulty === difficulty);
  if (exact) return exact;
  const idx = ORDER.indexOf(difficulty);
  for (let d = 1; d < ORDER.length; d++) {
    const easier = pool.find((t) => t.difficulty === ORDER[idx - d]);
    if (easier) return easier;
    const harder = pool.find((t) => t.difficulty === ORDER[idx + d]);
    if (harder) return harder;
  }
  return null;
}

/** Everything the candidate may see. Hidden tests and expected SQL results are excluded by construction. */
export function candidateTaskView(task: PracticalTask): CandidateTaskView {
  if (task.kind === "CODING") return codingView(task);
  return sqlView(task);
}

function codingView(task: CodingTask): CandidateTaskView {
  return {
    kind: "CODING",
    title: task.title,
    instructions: task.instructions,
    constraints: [...task.constraints],
    languages: task.languages.map((id) => ({ id, label: LANGUAGE_LABELS[id] })),
    starterCode: { ...task.starterCode },
    examples: task.visibleTests.map((t) => ({ name: t.name, input: t.input, expected: t.expected })),
    hiddenTestCount: task.hiddenTests.length,
    limits: {
      perTestTimeoutMs: task.limits.perTestTimeoutMs,
      memoryMb: task.limits.memoryMb,
      sourceMaxBytes: CODING_HARD_LIMITS.sourceMaxBytes,
    },
  };
}

function sqlView(task: SqlTask): CandidateTaskView {
  return {
    kind: "SQL",
    title: task.title,
    instructions: task.instructions,
    constraints: [...task.constraints],
    language: { id: SQL_LANGUAGE, label: LANGUAGE_LABELS[SQL_LANGUAGE] },
    schema: task.schema.map((t) => ({ name: t.name, columns: t.columns.map((c) => ({ ...c })) })),
    sampleData: task.sampleData.map((s) => ({ table: s.table, columns: [...s.columns], rows: s.rows.map((r) => [...r]) })),
    starterQuery: task.starterQuery,
    limits: {
      timeoutMs: task.limits.timeoutMs,
      maxRows: task.limits.maxRows,
      queryMaxBytes: SQL_HARD_LIMITS.queryMaxBytes,
    },
  };
}
