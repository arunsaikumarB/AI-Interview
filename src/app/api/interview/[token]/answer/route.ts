import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  mapAnswerProcessError,
  submitInterviewAnswer,
} from "@/lib/ai/submit-interview-answer";
import {
  releaseSessionLock,
  tryAcquireSessionLock,
} from "@/lib/ai/interview-session";

type Ctx = { params: { token: string } };

const bodySchema = z.object({
  answerText: z.string().min(1).max(20000),
  durationSec: z.number().int().min(0).max(60 * 60).optional(),
});

/**
 * Candidate submits a text answer (works in TEXT and VOICE sessions).
 * Returns ONLY { nextQuestion | concluded: true } — never scores.
 * On AIError after answer save: 503 retryable:true (client calls /continue).
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
    include: {
      questions: {
        orderBy: { sequence: "asc" },
        include: { answer: true },
      },
    },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired" }, { status: 410 });
  }
  if (session.status !== "IN_PROGRESS") {
    return Response.json({ error: "Interview is not in progress" }, { status: 400 });
  }

  if (!tryAcquireSessionLock(session.id)) {
    return Response.json(
      { error: "Another answer is already being processed", retryable: true },
      { status: 429 },
    );
  }

  try {
    const body = bodySchema.parse(await request.json());
    const current = session.questions.find((q) => !q.answer);
    if (!current) {
      return Response.json(
        { error: "No open question to answer", concluded: false },
        { status: 400 },
      );
    }

    const existingAnswer = await prisma.interviewAnswer.findUnique({
      where: { questionId: current.id },
    });
    if (existingAnswer) {
      return Response.json(
        { error: "This question was already answered", retryable: false },
        { status: 409 },
      );
    }

    try {
      const result = await submitInterviewAnswer({
        sessionId: session.id,
        questionId: current.id,
        answerText: body.answerText,
        durationSec: body.durationSec ?? null,
      });
      if (result.concluded) {
        return Response.json({ concluded: true });
      }
      return Response.json({
        concluded: false,
        nextQuestion: result.nextQuestion,
      });
    } catch (err) {
      return mapAnswerProcessError(err);
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 },
      );
    }
    return mapAnswerProcessError(err);
  } finally {
    releaseSessionLock(session.id);
  }
}
