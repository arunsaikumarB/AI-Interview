import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canViewAllApplications,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

type Ctx = { params: { id: string } };

/** Staff-only — CANDIDATE → 403. Portal uses /api/portal/applications. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);

    const application = await prisma.application.findUnique({
      where: { id: params.id },
      include: {
        job: {
          include: {
            department: { select: { id: true, name: true } },
            organization: { select: { id: true, name: true } },
          },
        },
        candidate: true,
        timelineEvents: { orderBy: { createdAt: "asc" } },
        aiEvaluations: { orderBy: { createdAt: "desc" } },
        interviewSessions: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!application) {
      return Response.json({ error: "Application not found" }, { status: 404 });
    }

    const canView =
      canViewAllApplications(user.role) &&
      (user.role === "SUPER_ADMIN" ||
        application.job.organizationId === user.organizationId);

    if (!canView) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const timeline = application.timelineEvents.map((t) => ({
      id: t.id,
      type: t.type,
      at: t.createdAt,
      payload: t.payload,
    }));

    return jsonOk({ application, timeline });
  } catch (err) {
    return handleApiError(err);
  }
}
