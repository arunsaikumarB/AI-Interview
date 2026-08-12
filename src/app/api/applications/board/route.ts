import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { PIPELINE_STAGES } from "@/lib/constants";

/** Kanban board payload grouped by pipeline stage. */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);
    const jobId = new URL(request.url).searchParams.get("jobId") ?? undefined;

    const applications = await prisma.application.findMany({
      where: {
        ...(jobId ? { jobId } : {}),
        job: scope.organizationId ? { organizationId: scope.organizationId } : undefined,
      },
      orderBy: { updatedAt: "desc" },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            department: { select: { name: true } },
          },
        },
        candidate: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        aiEvaluations: {
          where: { kind: "RESUME_SCREEN" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            scores: true,
            recommendation: true,
            createdAt: true,
          },
        },
      },
    });

    const columns = Object.fromEntries(
      PIPELINE_STAGES.map((stage) => [stage, [] as typeof applications]),
    ) as Record<(typeof PIPELINE_STAGES)[number], typeof applications>;

    for (const app of applications) {
      columns[app.stage].push(app);
    }

    return jsonOk({ columns, stages: PIPELINE_STAGES });
  } catch (err) {
    return handleApiError(err);
  }
}
