import type { Prisma } from "@prisma/client";
import { RESUME_PARSER_SOURCE } from "./constants";

/**
 * Keeps imported history that nobody has acted on yet (Resume Parser source, still
 * Applied + On hold) out of active-pipeline views. Once HR moves the stage or status,
 * the application shows up like any other.
 */
export const ACTIVE_PIPELINE_FILTER: Prisma.ApplicationWhereInput = {
  OR: [
    { source: null },
    { source: { not: RESUME_PARSER_SOURCE } },
    { status: { not: "ON_HOLD" } },
    { stage: { not: "APPLIED" } },
  ],
};

/**
 * Candidates page: people with at least one real HireOS application (Careers, upload with a
 * job, Add to Hiring, or an import HR has acted on). Talent-only profiles (uploaded without a
 * job, untouched Resume Parser history) live in Talent Pool until HR adds them to hiring.
 */
export const IN_HIRING_CANDIDATE_FILTER: Prisma.CandidateWhereInput = {
  applications: { some: ACTIVE_PIPELINE_FILTER },
};

export function isUntouchedImport(app: { source: string | null; status: string; stage: string }): boolean {
  return app.source === RESUME_PARSER_SOURCE && app.status === "ON_HOLD" && app.stage === "APPLIED";
}
