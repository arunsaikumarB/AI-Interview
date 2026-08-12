import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

type Ctx = { params: { id: string } };

/**
 * Invalidate a candidate interview link (expire token + cancel if not completed).
 * Does not change Application.stage.
 */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const sessionUser = await getSession();
    const user = requireStaff(sessionUser);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
      include: {
        application: {
          include: { job: { select: { organizationId: true } } },
        },
      },
    });

    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      interview.application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }

    if (interview.status === "COMPLETED") {
      return Response.json(
        { error: "Completed interviews cannot be expired" },
        { status: 400 },
      );
    }

    const updated = await prisma.interviewSession.update({
      where: { id: interview.id },
      data: {
        tokenExpiresAt: new Date(),
        status: "CANCELLED",
      },
      select: {
        id: true,
        status: true,
        tokenExpiresAt: true,
      },
    });

    try {
      const { endSecondaryCameraSession } = await import(
        "@/lib/secondary-camera-lifecycle"
      );
      await endSecondaryCameraSession(interview.id);
    } catch {
      /* non-fatal */
    }

    await prisma.timelineEvent.create({
      data: {
        applicationId: interview.applicationId,
        type: "OTHER",
        payload: {
          sessionId: interview.id,
          action: "INTERVIEW_LINK_EXPIRED",
          byUserId: user.id,
          advisoryOnly: true,
        },
      },
    });

    return jsonOk({ interview: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
