import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  requireUser,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { AIError } from "@/lib/ai/ollama";
import { queueAutoScreening } from "@/lib/ai/auto-screening";
import { getManualScreeningRunner } from "@/lib/ai/manual-screening";
import { enqueueDjangoJob } from "@/lib/staff-async/enqueue";
import { useDjangoAsync } from "@/lib/staff-async/flag";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

type Ctx = { params: { id: string } };

/**
 * Advisory resume screening via local Ollama, started in the background; the page polls
 * screen-status. `?batch=1` (Screen all) uses the one-at-a-time automatic queue instead.
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
      include: {
        job: { select: { organizationId: true } },
        candidate: { select: { resumeText: true } },
      },
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

    if (!application.candidate.resumeText?.trim()) {
      return Response.json(
        { error: "No resume text available for this candidate. Upload and parse a resume first." },
        { status: 400 },
      );
    }

    if (new URL(request.url).searchParams.get("batch") === "1") {
      if (!queueAutoScreening(params.id)) {
        return Response.json(
          { error: "The AI screening queue is full. Try again later.", busy: true },
          { status: 429 },
        );
      }
      return jsonOk({
        status: "QUEUED",
        advisoryOnly: true,
        message: "AI screening queued. Application stage/status unchanged — recruiter decides.",
      });
    }

    const started = getManualScreeningRunner().start(params.id);
    if (started === "BUSY") {
      return Response.json(
        { error: "The AI is already running other screenings. Try again in a minute.", busy: true },
        { status: 429 },
      );
    }
    return jsonOk({
      status: started,
      advisoryOnly: true,
      message: "AI screening started. Application stage/status unchanged — recruiter decides.",
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
