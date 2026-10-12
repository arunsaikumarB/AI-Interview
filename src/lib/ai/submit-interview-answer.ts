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

/** Candidate-facing text only — AI error messages carry internal hosts and model details. */
export const AI_UNAVAILABLE_MESSAGE =
  "The AI interviewer is not responding right now. Your answer was saved — retry in a moment.";
export const ANSWER_PROCESSING_FAILED_MESSAGE =
  "Your answer could not be processed right now. Retry in a moment.";

export function mapAnswerProcessError(err: unknown): Response {
  if (err instanceof AIError) {
    console.error("[interview] answer processing failed", { code: err.code, message: err.message });
    return Response.json(
      {
        error: AI_UNAVAILABLE_MESSAGE,
        code: err.code,
        retryable: true,
        ollamaDown:
          err.code === "OLLAMA_UNREACHABLE" || err.code === "OLLAMA_HTTP",
      },
      { status: 503 },
    );
  }
  console.error("[interview] answer processing failed", err);
  return Response.json(
    {
      error: ANSWER_PROCESSING_FAILED_MESSAGE,
      retryable: true,
    },
    { status: 503 },
  );
}
