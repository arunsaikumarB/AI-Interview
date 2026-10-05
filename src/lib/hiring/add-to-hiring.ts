import { Prisma, type PrismaClient } from "@prisma/client";
import { isUntouchedImport } from "@/lib/resume-parser-import/pipeline-filter";

export const ADD_TO_HIRING_SOURCE = "added_by_staff";

export type AddToHiringResult =
  | { kind: "added"; applicationId: string; reopenedImport: boolean }
  | { kind: "candidate_not_found" }
  | { kind: "job_not_open" }
  | { kind: "already_in_job" };

/**
 * Puts a candidate into hiring for one OPEN job opening: a new Applied / Active application.
 * Historical applications stay as they are. Runs no AI and creates no interview or assessment.
 *
 * Older imports could attach Resume Parser history to a job that is open today; that untouched
 * application (Applied + On hold) is reopened as Active instead of failing as a duplicate.
 */
export async function addToHiring(
  db: PrismaClient,
  args: { organizationId: string; candidateId: string; jobId: string },
): Promise<AddToHiringResult> {
  const { organizationId } = args;
  const [candidate, job] = await Promise.all([
    db.candidate.findFirst({ where: { id: args.candidateId, organizationId }, select: { id: true } }),
    db.job.findFirst({ where: { id: args.jobId, organizationId, status: "OPEN" }, select: { id: true } }),
  ]);
  if (!candidate) return { kind: "candidate_not_found" };
  if (!job) return { kind: "job_not_open" };

  try {
    const application = await db.application.create({
      data: {
        candidateId: candidate.id,
        jobId: job.id,
        stage: "APPLIED",
        status: "ACTIVE",
        source: ADD_TO_HIRING_SOURCE,
        timelineEvents: {
          create: { type: "APPLICATION_CREATED", payload: { source: ADD_TO_HIRING_SOURCE, existingCandidate: true } },
        },
      },
      select: { id: true },
    });
    return { kind: "added", applicationId: application.id, reopenedImport: false };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.application.findUnique({
      where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
      select: { id: true, source: true, status: true, stage: true },
    });
    if (!existing || !isUntouchedImport(existing)) return { kind: "already_in_job" as const };
    const reopened = await tx.application.updateMany({
      where: { id: existing.id, source: existing.source, status: "ON_HOLD", stage: "APPLIED" },
      data: { status: "ACTIVE" },
    });
    if (reopened.count === 0) return { kind: "already_in_job" as const };
    await tx.timelineEvent.create({
      data: {
        applicationId: existing.id,
        type: "STATUS_CHANGED",
        payload: { from: "ON_HOLD", to: "ACTIVE", reason: "added_to_hiring" },
      },
    });
    return { kind: "added" as const, applicationId: existing.id, reopenedImport: true };
  });
}
