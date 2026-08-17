import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { djangoAsyncStatus } from "@/lib/staff-async/enqueue";
import { normalizeAsyncStatus, useDjangoAsync } from "@/lib/staff-async/flag";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

type Ctx = { params: { id: string } };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }
    const kind = new URL(request.url).searchParams.get("kind") ?? "plan";
    if (!["plan", "finalize", "tts"].includes(kind)) {
      return Response.json({ error: "kind must be plan, finalize, or tts" }, { status: 400 });
    }
    if (!useDjangoAsync()) {
      return jsonOk({ status: "IDLE", task_id: null, kind });
    }
    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
      include: { application: { include: { job: { select: { organizationId: true } } } } },
    });
    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      interview.application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }
    const questionId = new URL(request.url).searchParams.get("questionId") ?? undefined;
    const body = await djangoAsyncStatus("/api/v1/interviews/status/", request, {
      session_id: params.id,
      kind,
      question_id: questionId,
    });
    return jsonOk({
      ...body,
      status: normalizeAsyncStatus(String(body.status ?? "idle")),
    });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
