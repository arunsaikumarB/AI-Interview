import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { enqueueDjangoJob } from "@/lib/staff-async/enqueue";
import { useDjangoAsync } from "@/lib/staff-async/flag";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

type Ctx = { params: { id: string } };

/** Staff-only TTS prefetch for persisted questions. Live candidate audio stays on Next.js. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }
    if (!useDjangoAsync()) {
      return Response.json({ error: "Async TTS prefetch is disabled" }, { status: 400 });
    }
    const body = (await request.json()) as { questionId?: string };
    const questionId = body.questionId?.trim();
    if (!questionId) {
      return Response.json({ error: "questionId is required" }, { status: 400 });
    }
    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
      include: {
        application: { include: { job: { select: { organizationId: true } } } },
        questions: { where: { id: questionId }, select: { id: true } },
      },
    });
    if (!interview || interview.questions.length === 0) {
      return Response.json({ error: "Interview question not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      interview.application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }
    const queued = await enqueueDjangoJob(
      "/api/v1/interviews/tts/",
      { session_id: params.id, question_id: questionId },
      "TTS_PREFETCH",
      request,
    );
    return jsonOk(queued);
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
