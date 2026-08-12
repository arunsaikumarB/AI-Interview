/**
 * @deprecated Prefer `@/lib/ai/screening` for JD vs resume screening.
 * Kept as a thin wrapper for older call sites.
 */
import { runResumeScreening, type ScreeningCandidateInput } from "@/lib/ai/screening";
import type { Job } from "@prisma/client";

export async function scoreWithReasoning(params: {
  task: string;
  context: string;
  model?: string;
}) {
  void params.task;
  void params.model;
  // Legacy helper — use runResumeScreening with structured inputs instead.
  throw new Error(
    "scoreWithReasoning is deprecated. Use runResumeScreening from @/lib/ai/screening.",
  );
}

export async function screenJobCandidate(params: {
  job: Pick<
    Job,
    | "title"
    | "description"
    | "skills"
    | "experienceMin"
    | "experienceMax"
    | "screeningCriteria"
  >;
  candidate: ScreeningCandidateInput;
}) {
  return runResumeScreening(params);
}
