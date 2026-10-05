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
