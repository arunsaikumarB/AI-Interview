import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, requireOrganizationId, requireRoles } from "@/lib/auth/rbac";
import { isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const ADD_TO_JOB_SOURCE = "added_by_staff";
const ADD_TO_JOB_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITER", "HIRING_MANAGER"];

const idSchema = z.string().min(1).max(64);
const bodySchema = z.object({ jobId: idSchema }).strict();

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Adds an existing candidate to a job: one Applied application, so it can be screened and interviewed. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const user = requireRoles(await getSession(), ADD_TO_JOB_ROLES);
    const organizationId = requireOrganizationId(user);

    const rl = rateLimit({ key: `add-to-job:${user.id}`, limit: 60, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return noStore(jsonError("Too many requests. Wait a few minutes and try again.", 429));

    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return noStore(jsonError("Send the request as JSON.", 415));
    }
    const candidateId = idSchema.safeParse(params.id);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!candidateId.success) return noStore(jsonError("Candidate not found", 404));
    if (!body.success) return noStore(jsonError("Choose a job from the list.", 400));

    const [candidate, job] = await Promise.all([
      prisma.candidate.findFirst({ where: { id: candidateId.data, organizationId }, select: { id: true } }),
      prisma.job.findFirst({
        where: { id: body.data.jobId, organizationId, status: { not: "CLOSED" } },
        select: { id: true },
      }),
    ]);
    if (!candidate) return noStore(jsonError("Candidate not found", 404));
    if (!job) return noStore(jsonError("Choose a job from the list.", 400));

    try {
      const application = await prisma.application.create({
        data: {
          candidateId: candidate.id,
          jobId: job.id,
          stage: "APPLIED",
          status: "ACTIVE",
          source: ADD_TO_JOB_SOURCE,
          timelineEvents: {
            create: { type: "APPLICATION_CREATED", payload: { source: ADD_TO_JOB_SOURCE, existingCandidate: true } },
          },
        },
        select: { id: true },
      });
      return noStore(jsonOk({ applicationId: application.id }, { status: 201 }));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return noStore(jsonError("This candidate is already in that job.", 409));
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof AuthError) return noStore(jsonError(err.message, err.status));
    if (isDatabaseUnavailable(err)) return noStore(jsonError("HireOS is temporarily unavailable. Try again.", 503));
    console.error("[add-to-job] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return noStore(jsonError("Could not add to the job. Try again.", 500));
  }
}
