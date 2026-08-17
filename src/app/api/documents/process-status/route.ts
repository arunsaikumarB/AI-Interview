import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireUser } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { djangoAsyncStatus } from "@/lib/staff-async/enqueue";
import { normalizeAsyncStatus, useDjangoAsync } from "@/lib/staff-async/flag";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }
    const candidateId = new URL(request.url).searchParams.get("candidateId")?.trim();
    if (!candidateId) {
      return Response.json({ error: "candidateId is required" }, { status: 400 });
    }
    if (!useDjangoAsync()) {
      return jsonOk({ status: "IDLE", task_id: null });
    }
    const candidate = await prisma.candidate.findFirst({
      where: {
        id: candidateId,
        ...(user.role === "SUPER_ADMIN" || !user.organizationId
          ? {}
          : { organizationId: user.organizationId }),
      },
      select: { id: true },
    });
    if (!candidate) {
      return Response.json({ error: "Candidate not found" }, { status: 404 });
    }
    const body = await djangoAsyncStatus("/api/v1/resumes/status/", request, {
      candidate_id: candidateId,
    });
    return jsonOk({
      ...body,
      status: normalizeAsyncStatus(String(body.status ?? "idle")),
    });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
