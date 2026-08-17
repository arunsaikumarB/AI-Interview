import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canViewAllApplications, orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { djangoListApplications } from "@/lib/staff-reads/django-reads";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoReads } from "@/lib/staff-reads/flag";

/** Staff pipeline list — CANDIDATE → 403. Candidates use /api/portal/applications. */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canViewAllApplications(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    if (useDjangoReads()) {
      const params = new URL(request.url).searchParams;
      const applications = await djangoListApplications(request, {
        q: params.get("q")?.trim() || undefined,
        stage: params.get("stage") || undefined,
        jobId: params.get("jobId") || undefined,
      });
      return jsonOk({ applications });
    }

    const scope = orgScopeWhere(user);
    const applications = await prisma.application.findMany({
      where: scope.organizationId
        ? { job: { organizationId: scope.organizationId } }
        : undefined,
      orderBy: { updatedAt: "desc" },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            status: true,
            department: { select: { name: true } },
          },
        },
        candidate: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        aiEvaluations: {
          where: { kind: "RESUME_SCREEN" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return jsonOk({ applications });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
