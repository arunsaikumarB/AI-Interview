import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  requireUser,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { AIError } from "@/lib/ai/ollama";
import { screenApplication } from "@/lib/ai/run-screening";
import { enqueueDjangoJob } from "@/lib/staff-async/enqueue";
import { useDjangoAsync } from "@/lib/staff-async/flag";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

type Ctx = { params: { id: string } };

/**
 * Advisory resume screening via local Ollama.
 * NEVER changes Application.stage or Application.status.
 * Each run creates a NEW AIEvaluation (history preserved).
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const application = await prisma.application.findUnique({
      where: { id: params.id },
      include: { job: { select: { organizationId: true } } },
    });

    if (!application) {
      return Response.json({ error: "Application not found" }, { status: 404 });
    }

    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }

    if (useDjangoAsync()) {
      const queued = await enqueueDjangoJob(
        "/api/v1/screening/",
        { application_id: params.id },
        "AI_SCREENING",
        request,
      );
      return jsonOk({
        ...queued,
        advisoryOnly: true,
        message:
          "AI screening queued. Application stage/status unchanged — recruiter decides.",
      });
    }

    const { evaluation, embeddingUpdated } = await screenApplication(params.id);

    return jsonOk({
      evaluation,
      embeddingUpdated,
      advisoryOnly: true,
      message:
        "AI suggestion stored. Application stage/status unchanged — recruiter decides.",
    });
  } catch (err) {
    if (err instanceof AIError) {
      return Response.json(
        {
          error: err.message,
          code: err.code,
          ollamaDown: err.code === "OLLAMA_UNREACHABLE" || err.code === "OLLAMA_HTTP",
        },
        { status: err.code === "VALIDATION" ? 400 : 503 },
      );
    }
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
