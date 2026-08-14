import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import { initialAdaptiveState } from "@/lib/ai/interview";
import { sanitizePlanForJob } from "@/lib/ai/interview-guard";
import {
  asJson,
  mapDifficultyToEnum,
  parsePlan,
  sessionEndsAt,
} from "@/lib/ai/interview-session";
import { prefetchQuestionTts } from "@/lib/question-tts";

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
      application: {
        include: {
          job: { select: { title: true, description: true, skills: true } },
        },
      },
    },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired. Please contact the recruiter." }, { status: 410 });
  }
  if (session.status === "COMPLETED") {
    return Response.json({ error: "Interview already completed" }, { status: 400 });
  }
  if (session.status === "TERMINATED") {
    return Response.json(
      {
        error: "Interview ended by integrity policy",
        terminated: true,
        status: "TERMINATED",
      },
      { status: 410 },
    );
  }
  if (session.status === "CANCELLED") {
    return Response.json({ error: "Interview cancelled" }, { status: 410 });
  }

  if (
    session.integrityMode === "STRICT" &&
    !session.integrityConsentAt
  ) {
    return Response.json(
      { error: "Please acknowledge interview integrity requirements first" },
      { status: 403 },
    );
  }

  if (session.status === "IN_PROGRESS" && session.questions[0]) {
    const endsAt = sessionEndsAt(session.startedAt, session.durationMinutes);
    return jsonOk({
      alreadyStarted: true,
      durationMinutes: session.durationMinutes,
      endsAt: endsAt?.toISOString() ?? null,
      question: {
        sequence: session.questions[0].sequence,
        question: session.questions[0].question,
      },
    });
  }

  const plan = sanitizePlanForJob(parsePlan(session.plan), {
    title: session.application.job.title,
    description: session.application.job.description,
    skills: session.application.job.skills,
    interviewType: session.interviewType,
  });
  const opening = plan.openingQuestion;
  const startedAt = new Date();

  const q = await prisma.$transaction(async (tx) => {
    await tx.interviewSession.update({
      where: { id: session.id },
      data: {
        status: "IN_PROGRESS",
        startedAt,
        adaptiveState: asJson(initialAdaptiveState(opening.difficulty)),
        plan: asJson(plan),
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

  prefetchQuestionTts({
    sessionId: session.id,
    questionId: q.id,
    sequence: q.sequence,
    text: q.question,
  });

  const endsAt = sessionEndsAt(startedAt, session.durationMinutes);

  return jsonOk({
    alreadyStarted: false,
    durationMinutes: session.durationMinutes,
    endsAt: endsAt?.toISOString() ?? null,
    question: {
      sequence: q.sequence,
      question: q.question,
    },
  });
});
