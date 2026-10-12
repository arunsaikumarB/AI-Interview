import { prisma } from "@/lib/db";
import { AIError } from "@/lib/ai/ollama";
import { processAnswerTurn } from "@/lib/ai/process-answer-turn";
import { mapAnswerProcessError } from "@/lib/ai/submit-interview-answer";
import {
  releaseSessionLock,
  tryAcquireSessionLock,
} from "@/lib/ai/interview-session";

type Ctx = { params: { token: string } };

/**
 * Retry turn processing after a 503 — answer already saved, no resubmit.
 * Returns ONLY { nextQuestion | concluded } — never scores.
 */
export async function POST(_request: Request, { params }: Ctx) {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json(
      {
        error:
          "This interview link has expired. Please contact the recruiter.",
      },
      { status: 410 },
    );
  }
  if (session.status === "CANCELLED") {
    return Response.json({ error: "Interview cancelled" }, { status: 410 });
  }
  if (session.status === "COMPLETED") {
    return Response.json({ concluded: true });
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
    const result = await processAnswerTurn(session.id);
    if (result.concluded) {
      return Response.json({ concluded: true });
    }
    return Response.json({
      concluded: false,
      nextQuestion: result.nextQuestion,
    });
  } catch (err) {
    if (err instanceof AIError) {
      // No saved answer yet — not an outage; client should reload state / answer first.
      if (err.code === "VALIDATION") {
        return Response.json(
          {
            error: "There is no saved answer to process yet.",
            code: err.code,
            retryable: false,
          },
          { status: 400 },
        );
      }
    }
    return mapAnswerProcessError(err);
  } finally {
    releaseSessionLock(session.id);
  }
}
