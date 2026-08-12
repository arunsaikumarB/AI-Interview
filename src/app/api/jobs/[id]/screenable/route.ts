import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  orgScopeWhere,
  requireUser,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

type Ctx = { params: { id: string } };

/** List ACTIVE APPLIED/SCREENING applications for progressive client-side screening. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const scope = orgScopeWhere(user);
    const job = await prisma.job.findFirst({
      where: { id: params.id, ...scope },
      select: { id: true, title: true },
    });
    if (!job) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    const applications = await prisma.application.findMany({
      where: {
        jobId: job.id,
        status: "ACTIVE",
        stage: { in: ["APPLIED", "SCREENING"] },
      },
      select: {
        id: true,
        stage: true,
        candidate: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            resumeText: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return jsonOk({
      job,
      applications: applications.map((a) => ({
        id: a.id,
        stage: a.stage,
        candidateName: `${a.candidate.firstName} ${a.candidate.lastName}`,
        hasResumeText: Boolean(a.candidate.resumeText?.trim()),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
