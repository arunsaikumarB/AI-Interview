import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import { sessionEndsAt } from "@/lib/ai/interview-session";

type Ctx = { params: { token: string } };

/**
 * Refresh-safe room state — past Q/A + current question.
 * Never includes scores, plan, or evaluation reasoning.
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
      questions: {
        orderBy: { sequence: "asc" },
        include: {
          answer: {
            select: {
              answerText: true,
              answeredAt: true,
              durationSec: true,
            },
          },
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

  const turns = session.questions.map((q) => ({
    sequence: q.sequence,
    question: q.question,
    answerText: q.answer?.answerText ?? null,
    answeredAt: q.answer?.answeredAt ?? null,
  }));

  const current =
    session.status === "IN_PROGRESS"
      ? session.questions.find((q) => !q.answer) ?? null
      : null;

  // Answer saved but nextTurn not finished (refresh after 503) — no open question yet.
  const pendingProcessing =
    session.status === "IN_PROGRESS" &&
    session.questions.length > 0 &&
    session.questions.every((q) => q.answer != null);

  const endsAt = sessionEndsAt(session.startedAt, session.durationMinutes);

  return jsonOk({
    status: session.status,
    mode: session.deliveryMode === "VOICE" ? "VOICE" : "TEXT",
    jobTitle: session.application.job.title,
    candidateFirstName: session.application.candidate.firstName,
    maxQuestions: session.maxQuestions,
    durationMinutes: session.durationMinutes,
    endsAt: endsAt?.toISOString() ?? null,
    turns,
    currentQuestion: current
      ? {
          sequence: current.sequence,
          question: current.question,
        }
      : null,
    pendingProcessing,
    concluded: session.status === "COMPLETED",
  });
});
