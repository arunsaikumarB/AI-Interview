import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import {
  InterviewPlanSchema,
  mapDifficultyToEnum,
  type AdaptiveState,
  type InterviewPlan,
  type TurnRecord,
  initialAdaptiveState,
} from "@/lib/ai/interview";

export { mapDifficultyToEnum, initialAdaptiveState };

export function createAccessToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenExpiresInDays(days = 7): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function parsePlan(raw: unknown): InterviewPlan {
  return InterviewPlanSchema.parse(raw);
}

export function parseAdaptiveState(raw: unknown): AdaptiveState {
  if (!raw || typeof raw !== "object") {
    return initialAdaptiveState();
  }
  const o = raw as Record<string, unknown>;
  return {
    currentTopicIndex: Number(o.currentTopicIndex ?? 0),
    questionsAsked: Number(o.questionsAsked ?? 0),
    followUpsOnCurrentTopic: Number(o.followUpsOnCurrentTopic ?? 0),
    topicsCovered: Array.isArray(o.topicsCovered)
      ? (o.topicsCovered as AdaptiveState["topicsCovered"])
      : [],
    difficulty: Number(o.difficulty ?? 3),
    concluded: Boolean(o.concluded),
  };
}

export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type Q = {
  sequence: number;
  question: string;
  topic: string | null;
  difficulty: string;
  answer: {
    answerText: string;
    evaluation: unknown;
  } | null;
};

export function turnsFromQuestions(questions: Q[]): TurnRecord[] {
  return questions
    .filter((q) => q.answer)
    .map((q) => {
      const ev = q.answer?.evaluation as { score?: number } | null;
      return {
        sequence: q.sequence,
        question: q.question,
        topic: q.topic ?? "General",
        difficulty:
          q.difficulty === "EASY" ? 2 : q.difficulty === "HARD" ? 4 : 3,
        answerText: q.answer!.answerText,
        score: typeof ev?.score === "number" ? ev.score : 0,
      };
    });
}

/** In-memory lock: 1 in-flight answer processing per session. */
const inflight = new Set<string>();

export function tryAcquireSessionLock(sessionId: string): boolean {
  if (inflight.has(sessionId)) return false;
  inflight.add(sessionId);
  return true;
}

export function releaseSessionLock(sessionId: string): void {
  inflight.delete(sessionId);
}
