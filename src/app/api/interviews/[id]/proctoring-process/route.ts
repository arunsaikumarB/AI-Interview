import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { djangoAsyncStatus, enqueueDjangoJob } from "@/lib/staff-async/enqueue";
import { normalizeAsyncStatus, useDjangoAsync } from "@/lib/staff-async/flag";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

type Ctx = { params: { id: string } };

const TERMINAL = new Set(["COMPLETED", "TERMINATED", "CANCELLED", "NO_SHOW"]);

export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }
    if (!useDjangoAsync()) {
      return Response.json({ error: "Async proctoring process is disabled" }, { status: 400 });
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
    if (!TERMINAL.has(interview.status)) {
      return Response.json(
        { error: "Session must be terminal to process proctoring" },
        { status: 400 },
      );
    }
    const queued = await enqueueDjangoJob(
      "/api/v1/proctoring/process/",
      { session_id: params.id, kind: "process" },
      "PROCTORING_PROCESS",
      request,
    );
    return jsonOk(queued);
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}

export async function GET(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }
    if (!useDjangoAsync()) {
      return jsonOk({ status: "IDLE", task_id: null });
    }
    const body = await djangoAsyncStatus("/api/v1/proctoring/status/", request, {
      session_id: params.id,
      kind: "process",
    });
    return jsonOk({
      ...body,
      status: normalizeAsyncStatus(String(body.status ?? "idle")),
    });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
