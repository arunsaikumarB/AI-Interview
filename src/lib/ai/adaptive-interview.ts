import { chatJSON } from "@/lib/ai/ollama";
import { z } from "zod";

export type AdaptiveState = {
  topics: string[];
  difficulty: number;
  turnCount: number;
  focusGaps: string[];
};

export type NextQuestion = {
  question: string;
  topic: string;
  difficulty: number;
  adaptiveState: AdaptiveState;
};

const NextQuestionSchema = z.object({
  question: z.string().min(1),
  topic: z.string().min(1),
  difficulty: z.number().min(1).max(5),
  focusGaps: z.array(z.string()).optional(),
});

/**
 * Adaptive AI interview (Phase 4) — text-only question generation.
 * Not used by Phase 3 screening.
 */
export async function generateNextQuestion(params: {
  jobTitle: string;
  jobRequirements: string;
  state: AdaptiveState;
  lastAnswer?: { question: string; answer: string; score?: number };
}): Promise<NextQuestion> {
  const { data } = await chatJSON(
    `You generate adaptive interview questions for a hiring platform.
Respond with JSON only:
{ "question": string, "topic": string, "difficulty": 1-5, "focusGaps": string[] }
Stay job-relevant. No demographic or personal questions.`,
    JSON.stringify({
      jobTitle: params.jobTitle,
      requirements: params.jobRequirements,
      state: params.state,
      lastAnswer: params.lastAnswer ?? null,
    }),
    NextQuestionSchema,
  );

  const difficulty = Math.min(5, Math.max(1, Math.round(data.difficulty)));
  const focusGaps = data.focusGaps ?? params.state.focusGaps;
  const topics = params.state.topics.includes(data.topic)
    ? params.state.topics
    : [...params.state.topics, data.topic];

  return {
    question: data.question,
    topic: data.topic,
    difficulty,
    adaptiveState: {
      topics,
      difficulty,
      turnCount: params.state.turnCount + 1,
      focusGaps,
    },
  };
}

export function initialAdaptiveState(): AdaptiveState {
  return {
    topics: [],
    difficulty: 3,
    turnCount: 0,
    focusGaps: [],
  };
}
