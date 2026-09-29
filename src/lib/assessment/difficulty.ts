import type { Importance, QuestionType, Seniority } from "./types";

const BASE: Record<Seniority, number> = {
  INTERN: 1,
  JUNIOR: 2,
  MID: 3,
  SENIOR: 4,
  LEAD: 4,
  PRINCIPAL: 5,
  UNKNOWN: 3,
};

/** Ceiling per seniority so junior roles never receive senior-level questions. */
const CAP: Record<Seniority, number> = {
  INTERN: 2,
  JUNIOR: 3,
  MID: 4,
  SENIOR: 5,
  LEAD: 5,
  PRINCIPAL: 5,
  UNKNOWN: 4,
};

const TYPE_DELTA: Record<QuestionType, number> = {
  FUNDAMENTAL: -1,
  RESUME_VERIFICATION: 0,
  BEHAVIORAL: -1,
  COMMUNICATION: -1,
  SCENARIO: 0,
  TECHNICAL_REASONING: 0,
  ADVANCED: 1,
  PRACTICAL_RECOMMENDATION: 0,
};

export function difficultyFor(
  seniority: Seniority,
  importance: Importance,
  type: QuestionType,
): { difficulty: number; rationale: string } {
  const base = BASE[seniority];
  const typeDelta = TYPE_DELTA[type];
  const importanceDelta = importance === "LOW" ? -1 : 0;
  const cap = CAP[seniority];
  const raw = base + typeDelta + importanceDelta;
  const difficulty = Math.max(1, Math.min(cap, raw));
  const parts = [`base ${base} for ${seniority === "UNKNOWN" ? "unstated" : seniority} seniority`];
  if (typeDelta) parts.push(`${typeDelta > 0 ? "+" : ""}${typeDelta} for ${type.toLowerCase().replace(/_/g, " ")}`);
  if (importanceDelta) parts.push("-1 for low-importance competency");
  if (raw > cap) parts.push(`capped at ${cap}`);
  return { difficulty, rationale: `Difficulty ${difficulty}/5: ${parts.join(", ")}.` };
}
