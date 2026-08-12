import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

/**
 * Communication log list — org-scoped via actor membership / template org.
 * ?candidateId= filters to one candidate (meta.candidateId).
 * ?limit= defaults 100.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);
    const url = new URL(request.url);
    const candidateId = url.searchParams.get("candidateId");
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit") ?? "100") || 100),
    );

    const orgId = scope.organizationId;
    const logs = await prisma.communicationLog.findMany({
      where: {
        ...(candidateId
          ? {
              meta: {
                path: ["candidateId"],
                equals: candidateId,
              },
            }
          : {}),
        ...(orgId
          ? {
              OR: [
                { actor: { organizationId: orgId } },
                { template: { organizationId: orgId } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        template: { select: { id: true, name: true, category: true } },
        actor: { select: { id: true, name: true, email: true } },
      },
    });

    // Extra guard: candidate must belong to org when filtering
    if (candidateId && orgId) {
      const cand = await prisma.candidate.findFirst({
        where: { id: candidateId, organizationId: orgId },
        select: { id: true },
      });
      if (!cand) {
        return Response.json({ error: "Candidate not found" }, { status: 404 });
      }
    }

    return jsonOk({
      logs: logs.map((l) => ({
        id: l.id,
        toAddress: l.toAddress,
        status: l.status,
        subject: l.subject,
        body: l.body,
        meta: l.meta,
        sentAt: l.sentAt,
        createdAt: l.createdAt,
        template: l.template,
        actor: l.actor,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
