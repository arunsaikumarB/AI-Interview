import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { djangoListCandidates } from "@/lib/staff-reads/django-reads";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoReads } from "@/lib/staff-reads/flag";

/** Staff talent list — CANDIDATE → 403. Portal uses /api/portal/profile. */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);
    const q = new URL(request.url).searchParams.get("q")?.trim();

    if (useDjangoReads()) {
      const candidates = await djangoListCandidates(request, q || undefined);
      return jsonOk({ candidates });
    }

    const candidates = await prisma.candidate.findMany({
      where: {
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { skills: { hasSome: [q] } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { applications: true } },
      },
    });

    return jsonOk({ candidates });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
