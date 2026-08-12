import { prisma } from "@/lib/db";
import { AIError } from "@/lib/ai/ollama";
import { processAnswerTurn } from "@/lib/ai/process-answer-turn";

/**
 * Shared TEXT/VOICE answer path: persist answer → processAnswerTurn.
 * Caller owns session lock + idempotency checks.
 */
export async function submitInterviewAnswer(params: {
  sessionId: string;
  questionId: string;
  answerText: string;
  durationSec?: number | null;
  audioPath?: string | null;
  transcriptConfidence?: number | null;
}): Promise<{
  concluded: boolean;
  nextQuestion: { sequence: number; question: string } | null;
}> {
  await prisma.interviewAnswer.create({
    data: {
      sessionId: params.sessionId,
      questionId: params.questionId,
      answerText: params.answerText,
      durationSec: params.durationSec ?? null,
      audioPath: params.audioPath ?? null,
      transcriptConfidence: params.transcriptConfidence ?? null,
    },
  });

  return processAnswerTurn(params.sessionId);
}

export function mapAnswerProcessError(err: unknown): Response {
  if (err instanceof AIError) {
    return Response.json(
      {
        error: err.message,
        code: err.code,
        retryable: true,
        ollamaDown:
          err.code === "OLLAMA_UNREACHABLE" || err.code === "OLLAMA_HTTP",
      },
      { status: 503 },
    );
  }
  console.error(err);
  return Response.json(
    {
      error: err instanceof Error ? err.message : "Answer processing failed",
      retryable: true,
    },
    { status: 503 },
  );
}
