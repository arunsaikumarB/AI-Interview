import type { PrismaClient } from "@prisma/client";
import { addToHiring } from "@/lib/hiring/add-to-hiring";

export type AddToJobResult =
  | { job: "added"; applicationId: string; screening: "started" | "busy" | "no_resume_text" }
  | { job: "already_in_job" | "job_not_open" | "candidate_not_found" };

/**
 * Puts a Talent Pool candidate into one OPEN job (Applied / Active) and queues advisory AI
 * resume screening. Screening never changes stage or status and never blocks the add.
 */
export async function addCandidateToJob(
  db: PrismaClient,
  args: { organizationId: string; candidateId: string; jobId: string },
  queueScreening: (applicationId: string) => boolean,
): Promise<AddToJobResult> {
  const added = await addToHiring(db, args);
  if (added.kind !== "added") return { job: added.kind };

  const candidate = await db.candidate.findFirst({
    where: { id: args.candidateId, organizationId: args.organizationId },
    select: { resumeText: true },
  });
  if (!candidate?.resumeText?.trim()) {
    return { job: "added", applicationId: added.applicationId, screening: "no_resume_text" };
  }
  const queued = queueScreening(added.applicationId);
  return { job: "added", applicationId: added.applicationId, screening: queued ? "started" : "busy" };
}
