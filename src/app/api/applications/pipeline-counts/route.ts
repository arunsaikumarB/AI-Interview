import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { PIPELINE_STAGES } from "@/lib/constants";
import { djangoPipelineCounts } from "@/lib/staff-reads/django-reads";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoReads } from "@/lib/staff-reads/flag";

/** Stage histogram. Kanban cards remain GET /api/applications/board (Prisma). */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const jobId = new URL(request.url).searchParams.get("jobId") ?? undefined;

    if (useDjangoReads()) {
      return jsonOk(await djangoPipelineCounts(request, jobId));
    }

    const scope = orgScopeWhere(user);
    const grouped = await prisma.application.groupBy({
      by: ["stage"],
      where: {
        ...(jobId ? { jobId } : {}),
        job: scope.organizationId ? { organizationId: scope.organizationId } : undefined,
      },
      _count: { _all: true },
    });
    const counted = Object.fromEntries(
      grouped.map((row) => [row.stage, row._count._all]),
    ) as Record<string, number>;
    const counts = Object.fromEntries(
      PIPELINE_STAGES.map((stage) => [stage, counted[stage] ?? 0]),
    );
    return jsonOk({ counts, stages: PIPELINE_STAGES });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
