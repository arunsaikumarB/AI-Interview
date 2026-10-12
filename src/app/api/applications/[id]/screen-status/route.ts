import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireUser } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { djangoAsyncStatus } from "@/lib/staff-async/enqueue";
import { normalizeAsyncStatus, useDjangoAsync } from "@/lib/staff-async/flag";
import {
  SCREENING_CLOCK_SLACK_MS,
  fallbackScreeningStatus,
  getManualScreeningRunner,
  parseScreeningSince,
} from "@/lib/ai/manual-screening";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

type Ctx = { params: { id: string } };

export async function GET(request: Request, { params }: Ctx) {
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
    if (!useDjangoAsync()) {
      const local = getManualScreeningRunner().status(params.id);
      if (local) {
        return jsonOk({ status: local.status, task_id: null, ...(local.error ? { error: local.error } : {}) });
      }
      const since = parseScreeningSince(new URL(request.url).searchParams.get("since"));
      const resultSince = since
        ? (await prisma.aIEvaluation.count({
            where: {
              applicationId: params.id,
              kind: "RESUME_SCREEN",
              createdAt: { gte: new Date(since.getTime() - SCREENING_CLOCK_SLACK_MS) },
            },
          })) > 0
        : false;
      const fallback = fallbackScreeningStatus({ since, resultSince });
      return jsonOk({ status: fallback.status, task_id: null, ...(fallback.error ? { error: fallback.error } : {}) });
    }
    const body = await djangoAsyncStatus("/api/v1/screening/status/", request, {
      application_id: params.id,
    });
    return jsonOk({
      ...body,
      status: normalizeAsyncStatus(String(body.status ?? "idle")),
    });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
