import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { requireCandidate } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { candidateStageLabel } from "@/lib/constants";

/**
 * Candidate portal — own applications only.
 * Never includes AI scores, screening %, evaluations, or notes.
 */
export async function GET() {
  try {
    const session = await getSession();
    const user = requireCandidate(session);

    const candidate = await prisma.candidate.findUnique({
      where: { userId: user.id },
    });
    if (!candidate) {
      return jsonOk({ applications: [] });
    }

    const applications = await prisma.application.findMany({
      where: { candidateId: candidate.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        stage: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        job: {
          select: {
            id: true,
            title: true,
            department: { select: { name: true } },
          },
        },
        interviewSessions: {
          where: {
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }],
          },
          select: {
            id: true,
            status: true,
            accessToken: true,
            deliveryMode: true,
            interviewType: true,
            scheduledAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return jsonOk({
      applications: applications.map((app) => ({
        id: app.id,
        jobTitle: app.job.title,
        department: app.job.department?.name ?? null,
        stageLabel: candidateStageLabel(app.stage),
        status: app.status,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
        interviews: app.interviewSessions.map((s) => ({
          id: s.id,
          status: s.status,
          accessToken: s.accessToken,
          deliveryMode: s.deliveryMode,
          interviewType: s.interviewType,
          scheduledAt: s.scheduledAt,
          actionLabel: s.status === "IN_PROGRESS" ? "Continue interview" : "Start interview",
          href: `/interview/${s.accessToken}`,
        })),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
