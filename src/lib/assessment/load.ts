import { prisma } from "@/lib/db";
import { orgScopeWhere } from "@/lib/auth/rbac";
import type { SessionUser } from "@/lib/auth/session";
import type { CandidateInput, JobInput } from "./types";

/** cuid or seeded slug ids (e.g. "seed-fullstack-engineer"); anything else is rejected before touching the database. */
export const RECORD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type BlueprintSources =
  | { kind: "JOB_NOT_FOUND" }
  | { kind: "APPLICATION_NOT_FOUND" }
  | { kind: "OK"; job: JobInput; candidate: CandidateInput | null };

/**
 * Loads only the fields the engine needs, scoped to the caller's organisation.
 * The application must belong to the scoped job — a browser-supplied
 * applicationId from another job or organisation resolves to "not found".
 */
export async function loadBlueprintSources(
  user: SessionUser,
  jobId: string,
  applicationId: string | null,
): Promise<BlueprintSources> {
  const scope = orgScopeWhere(user);
  const job = await prisma.job.findFirst({
    where: { id: jobId, ...scope },
    select: {
      id: true,
      organizationId: true,
      title: true,
      description: true,
      skills: true,
      experienceMin: true,
      experienceMax: true,
      screeningCriteria: true,
    },
  });
  if (!job) return { kind: "JOB_NOT_FOUND" };

  let candidate: CandidateInput | null = null;
  if (applicationId) {
    const app = await prisma.application.findFirst({
      where: { id: applicationId, jobId: job.id },
      select: {
        id: true,
        candidate: {
          select: {
            organizationId: true,
            firstName: true,
            lastName: true,
            resumeText: true,
            skills: true,
          },
        },
      },
    });
    if (!app || app.candidate.organizationId !== job.organizationId) {
      return { kind: "APPLICATION_NOT_FOUND" };
    }
    candidate = {
      applicationId: app.id,
      name: `${app.candidate.firstName} ${app.candidate.lastName}`.trim(),
      resumeText: app.candidate.resumeText,
      skills: app.candidate.skills,
    };
  }

  return {
    kind: "OK",
    job: {
      id: job.id,
      title: job.title,
      description: job.description,
      skills: job.skills,
      experienceMin: job.experienceMin,
      experienceMax: job.experienceMax,
      screeningCriteria: job.screeningCriteria,
    },
    candidate,
  };
}
