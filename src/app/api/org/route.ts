import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);

    const organizations = await prisma.organization.findMany({
      where: scope.organizationId ? { id: scope.organizationId } : undefined,
      include: {
        departments: { orderBy: { name: "asc" } },
        _count: { select: { users: true, jobs: true } },
      },
      orderBy: { name: "asc" },
    });

    return jsonOk({ organizations });
  } catch (err) {
    return handleApiError(err);
  }
}
