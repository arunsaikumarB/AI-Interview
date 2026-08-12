import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  orgScopeWhere,
  requireUser,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { AIError } from "@/lib/ai/ollama";
import { screenApplication } from "@/lib/ai/run-screening";

type Ctx = { params: { id: string } };

/**
 * Screen every ACTIVE application in APPLIED or SCREENING that has resume text.
 * Runs SEQUENTIALLY (one Ollama call at a time — local GPU).
 * NEVER changes Application.stage or status.
 */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const scope = orgScopeWhere(user);
    const job = await prisma.job.findFirst({
      where: { id: params.id, ...scope },
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
      include: {
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

    let screened = 0;
    const skipped: { applicationId: string; candidate: string; reason: string }[] =
      [];
    const failed: { applicationId: string; candidate: string; error: string }[] =
      [];

    // Sequential — do NOT Promise.all (local GPU / Ollama).
    for (const app of applications) {
      const name = `${app.candidate.firstName} ${app.candidate.lastName}`;
      if (!app.candidate.resumeText?.trim()) {
        skipped.push({
          applicationId: app.id,
          candidate: name,
          reason: "No resume text extracted",
        });
        continue;
      }

      try {
        await screenApplication(app.id);
        screened += 1;
      } catch (err) {
        failed.push({
          applicationId: app.id,
          candidate: name,
          error:
            err instanceof AIError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Screening failed",
        });
      }
    }

    return jsonOk({
      screened,
      skipped,
      failed,
      total: applications.length,
      advisoryOnly: true,
      message:
        "Batch screening complete. No application stages or statuses were changed.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
