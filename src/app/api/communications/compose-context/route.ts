import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { STAGE_LABELS } from "@/lib/constants";
import type { TemplateContext } from "@/lib/templates";
import { getMailMode } from "@/lib/mail";

/**
 * Build variable context for the compose dialog (recruiter+).
 * ?candidateId=&applicationId=
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);
    const url = new URL(request.url);
    const candidateId = url.searchParams.get("candidateId");
    const applicationId = url.searchParams.get("applicationId");

    if (!candidateId) {
      return Response.json({ error: "candidateId required" }, { status: 400 });
    }

    const candidate = await prisma.candidate.findFirst({
      where: {
        id: candidateId,
        ...(scope.organizationId
          ? { organizationId: scope.organizationId }
          : {}),
      },
      include: {
        organization: { select: { name: true, companyName: true } },
        applications: {
          ...(applicationId ? { where: { id: applicationId } } : {}),
          orderBy: { updatedAt: "desc" },
          take: 1,
          include: {
            job: { select: { title: true } },
            interviewSessions: {
              where: { status: "SCHEDULED" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { accessToken: true, status: true, id: true },
            },
          },
        },
      },
    });

    if (!candidate) {
      return Response.json({ error: "Candidate not found" }, { status: 404 });
    }

    const app = candidate.applications[0] ?? null;
    const scheduled = app?.interviewSessions[0] ?? null;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const interviewLink = scheduled
      ? `${appUrl}/interview/${scheduled.accessToken}`
      : null;

    const context: TemplateContext = {
      candidateFirstName: candidate.firstName,
      candidateLastName: candidate.lastName,
      jobTitle: app?.job.title ?? null,
      companyName:
        candidate.organization.companyName?.trim() ||
        candidate.organization.name,
      interviewLink,
      recruiterName: user.name,
      stage: app ? STAGE_LABELS[app.stage] ?? app.stage : null,
    };

    return jsonOk({
      mailMode: getMailMode(),
      candidate: {
        id: candidate.id,
        email: candidate.email,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
      },
      applicationId: app?.id ?? null,
      interviewLink,
      interviewLinkWarning: !interviewLink
        ? "No SCHEDULED interview session — {{interviewLink}} will be missing"
        : null,
      context,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
