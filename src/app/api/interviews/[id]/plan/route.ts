import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import {
  InterviewPlanEditSchema,
  summarizePlanDiff,
} from "@/lib/ai/plan-refine";
import {
  asJson,
  initialAdaptiveState,
  parsePlan,
} from "@/lib/ai/interview-session";

type Ctx = { params: { id: string } };

async function loadOwnedSession(id: string, orgId: string | null) {
  const interview = await prisma.interviewSession.findUnique({
    where: { id },
    include: {
      application: {
        include: {
          job: { select: { organizationId: true, title: true } },
          candidate: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });
  if (!interview) return null;
  if (
    orgId &&
    interview.application.job.organizationId !== orgId
  ) {
    return null;
  }
  return interview;
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const interview = await loadOwnedSession(
      params.id,
      user.role === "SUPER_ADMIN" ? null : user.organizationId,
    );
    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }

    const plan = parsePlan(interview.plan);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    return jsonOk({
      interview: {
        id: interview.id,
        status: interview.status,
        interviewType: interview.interviewType,
        mode: interview.deliveryMode,
        maxQuestions: interview.maxQuestions,
        accessToken: interview.accessToken,
        proctoringEnabled: interview.proctoringEnabled,
      },
      candidateLink: `${appUrl}/interview/${interview.accessToken}`,
      candidate: interview.application.candidate,
      jobTitle: interview.application.job.title,
      plan,
      editable: interview.status === "SCHEDULED",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const interview = await loadOwnedSession(
      params.id,
      user.role === "SUPER_ADMIN" ? null : user.organizationId,
    );
    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (interview.status !== "SCHEDULED") {
      return Response.json(
        { error: "Plan is locked once the interview is in progress" },
        { status: 400 },
      );
    }

    const body = InterviewPlanEditSchema.parse(await request.json());
    const before = parsePlan(interview.plan);
    const changes = summarizePlanDiff(before, body);

    await prisma.interviewSession.update({
      where: { id: interview.id },
      data: {
        plan: asJson(body),
        adaptiveState: asJson(
          initialAdaptiveState(body.openingQuestion.difficulty),
        ),
      },
    });

    await prisma.timelineEvent.create({
      data: {
        applicationId: interview.applicationId,
        type: "OTHER",
        payload: {
          kind: "plan_edited",
          sessionId: interview.id,
          changes,
          actorId: user.id,
          advisoryOnly: true,
        },
      },
    });

    return jsonOk({ plan: body, changes });
  } catch (err) {
    return handleApiError(err);
  }
}
