import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import { initialAdaptiveState } from "@/lib/ai/interview";
import {
  asJson,
  mapDifficultyToEnum,
  parsePlan,
} from "@/lib/ai/interview-session";

type Ctx = { params: { token: string } };

/**
 * Start interview — store opening question as sequence 1.
 * Never returns scores/plan.
 */
export const POST = withApiHandler<Ctx>(async (_request, { params }) => {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
    include: {
      questions: { orderBy: { sequence: "asc" }, take: 1 },
    },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired" }, { status: 410 });
  }
  if (session.status === "COMPLETED") {
    return Response.json({ error: "Interview already completed" }, { status: 400 });
  }
  if (session.status === "CANCELLED") {
    return Response.json({ error: "Interview cancelled" }, { status: 410 });
  }

  if (session.status === "IN_PROGRESS" && session.questions[0]) {
    return jsonOk({
      alreadyStarted: true,
      question: {
        sequence: session.questions[0].sequence,
        question: session.questions[0].question,
      },
    });
  }

  const plan = parsePlan(session.plan);
  const opening = plan.openingQuestion;

  const q = await prisma.$transaction(async (tx) => {
    await tx.interviewSession.update({
      where: { id: session.id },
      data: {
        status: "IN_PROGRESS",
        startedAt: new Date(),
        adaptiveState: asJson(initialAdaptiveState(opening.difficulty)),
      },
    });

    const question = await tx.interviewQuestion.create({
      data: {
        sessionId: session.id,
        sequence: 1,
        question: opening.question,
        topic: opening.topic,
        difficulty: mapDifficultyToEnum(opening.difficulty),
        competency: opening.competency,
        action: "OPENING",
      },
    });

    await tx.timelineEvent.create({
      data: {
        applicationId: session.applicationId,
        type: "INTERVIEW_STARTED",
        payload: {
          sessionId: session.id,
          advisoryOnly: true,
        },
      },
    });

    return question;
  });

  return jsonOk({
    alreadyStarted: false,
    question: {
      sequence: q.sequence,
      question: q.question,
    },
  });
});
