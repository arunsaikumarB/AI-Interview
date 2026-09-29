import type { AssessmentBlueprint, Competency } from "@/lib/assessment/types";
import { pickTask } from "./tasks";
import type { PracticalKind, PracticalTask, TaskDifficulty } from "./types";

/**
 * Chooses a practical task from the V1 blueprint. The blueprint stays the
 * source of truth: competency and difficulty come from it, never from the
 * browser. The recruiter only chooses the runtime (CODING or SQL).
 */

const RUNTIME_FOR_RECOMMENDATION: Partial<Record<string, PracticalKind>> = {
  CODING_EXERCISE: "CODING",
  SQL_ANALYSIS: "SQL",
};

const SQL_COMPETENCY = /\b(sql|database|data access|persistence|query|queries|postgres|mysql|data model|analytics|data analysis)\b/i;
const CODING_COMPETENCY =
  /(^|[^a-z])(python|javascript|typescript|node(\.js)?|java|golang|rust|c\+\+|c#|kotlin|swift|react|angular|vue|django|flask|express|spring|\.net|programming|coding|algorithms?|data structures|problem solving|software engineering)([^a-z]|$)/i;

export type PracticalProvenance = {
  engineVersion: string;
  blueprintGeneratedAt: string;
  jobId: string;
  applicationId: string;
  recommendation: { type: string; title: string; competency: string; estimatedDifficulty: number };
  questionSpecId: string | null;
  runtime: PracticalKind;
  runtimeMatchesRecommendation: boolean;
  competencyId: string | null;
  competencySource: "PRACTICAL_RECOMMENDATION" | "BLUEPRINT_COMPETENCY";
  difficultyScore: number;
};

export type PracticalSelection =
  | { ok: true; task: PracticalTask; competency: string; difficulty: TaskDifficulty; provenance: PracticalProvenance }
  | { ok: false; reason: "NO_APPLICATION_CONTEXT" | "NO_MATCHING_COMPETENCY" | "NO_TASK" };

export function difficultyBand(score: number): TaskDifficulty {
  if (score <= 2) return "EASY";
  if (score === 3) return "MEDIUM";
  return "HARD";
}

function findCompetency(blueprint: AssessmentBlueprint, runtime: PracticalKind): Competency | null {
  const technical = blueprint.competencies.filter((c) => c.category === "TECHNICAL" || c.category === "PRACTICE");
  if (runtime === "SQL") {
    return technical.find((c) => SQL_COMPETENCY.test(c.name)) ?? null;
  }
  // An algorithmic task only evidences programming ability — never SQL, tooling or design skills.
  const codingCapable = technical.filter((c) => !SQL_COMPETENCY.test(c.name) && CODING_COMPETENCY.test(c.name));
  return codingCapable.find((c) => c.source === "JD_REQUIRED") ?? codingCapable[0] ?? null;
}

export function selectPracticalTask(blueprint: AssessmentBlueprint, runtime: PracticalKind): PracticalSelection {
  if (!blueprint.candidate) return { ok: false, reason: "NO_APPLICATION_CONTEXT" };
  const rec = blueprint.practical;
  const matches = RUNTIME_FOR_RECOMMENDATION[rec.type] === runtime;

  let competencyName: string;
  let competencyId: string | null;
  let competencySource: PracticalProvenance["competencySource"];
  if (matches) {
    competencyName = rec.competency;
    competencyId = blueprint.competencies.find((c) => c.name === rec.competency)?.id ?? null;
    competencySource = "PRACTICAL_RECOMMENDATION";
  } else {
    const c = findCompetency(blueprint, runtime);
    if (!c) return { ok: false, reason: "NO_MATCHING_COMPETENCY" };
    competencyName = c.name;
    competencyId = c.id;
    competencySource = "BLUEPRINT_COMPETENCY";
  }

  const score = Math.max(1, Math.min(5, Math.round(rec.estimatedDifficulty)));
  const difficulty = difficultyBand(score);
  const task = pickTask(runtime, difficulty);
  if (!task) return { ok: false, reason: "NO_TASK" };

  return {
    ok: true,
    task,
    competency: competencyName,
    difficulty: task.difficulty,
    provenance: {
      engineVersion: blueprint.engineVersion,
      blueprintGeneratedAt: blueprint.generatedAt,
      jobId: blueprint.job.id,
      applicationId: blueprint.candidate.applicationId,
      recommendation: {
        type: rec.type,
        title: rec.title,
        competency: rec.competency,
        estimatedDifficulty: rec.estimatedDifficulty,
      },
      questionSpecId: blueprint.questions.find((q) => q.type === "PRACTICAL_RECOMMENDATION")?.id ?? null,
      runtime,
      runtimeMatchesRecommendation: matches,
      competencyId,
      competencySource,
      difficultyScore: score,
    },
  };
}
