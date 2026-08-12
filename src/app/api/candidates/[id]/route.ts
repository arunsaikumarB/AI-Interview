import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

type Ctx = { params: { id: string } };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);

    const candidate = await prisma.candidate.findFirst({
      where: {
        id: params.id,
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      },
      include: {
        applications: {
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
            timelineEvents: { orderBy: { createdAt: "asc" } },
            aiEvaluations: { orderBy: { createdAt: "desc" } },
          },
        },
        notes: {
          orderBy: { createdAt: "desc" },
          include: { author: { select: { id: true, name: true } } },
        },
        tags: { include: { tag: true } },
      },
    });

    if (!candidate) {
      return Response.json({ error: "Candidate not found" }, { status: 404 });
    }

    return jsonOk({ candidate });
  } catch (err) {
    return handleApiError(err);
  }
}
