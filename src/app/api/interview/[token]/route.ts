import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";

type Ctx = { params: { token: string } };

/**
 * Public candidate interview info — no auth session.
 * Never returns scores, plan, or reasoning.
 */
export const GET = withApiHandler<Ctx>(async (_request, { params }) => {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
    include: {
      application: {
        include: {
          job: { select: { title: true } },
          candidate: { select: { firstName: true } },
        },
      },
      _count: { select: { questions: true } },
    },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }

  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired" }, { status: 410 });
  }

  if (session.status === "CANCELLED") {
    return Response.json({ error: "This interview was cancelled" }, { status: 410 });
  }

  const deliveryMode = session.deliveryMode === "VOICE" ? "VOICE" : "TEXT";

  return jsonOk({
    status: session.status,
    interviewType: session.interviewType,
    mode: deliveryMode,
    proctoringEnabled: session.proctoringEnabled,
    proctoringConsentAt: session.proctoringConsentAt,
    cameraConsent: session.proctoringCameraConsent,
    maxQuestions: session.maxQuestions,
    jobTitle: session.application.job.title,
    candidateFirstName: session.application.candidate.firstName,
    questionsAsked: session._count.questions,
    instructions:
      deliveryMode === "VOICE"
        ? "This is a voice interview. You can also type answers if needed. One question at a time."
        : "This is a text interview. Answer thoughtfully — take your time. You will see one question at a time.",
    concluded: session.status === "COMPLETED",
  });
});
