import { z } from "zod";
import type { AIRecommendation, Job } from "@prisma/client";
import { AIError, chatJSON } from "@/lib/ai/ollama";
import type { ScreeningResult } from "@/lib/ai/screening";

/**
 * Adaptive AI Interview Engine (TEXT-ONLY).
 * Advisory only — never mutates Application.stage or status.
 */

// -----------------------------------------------------------------------------
// Types & Zod schemas
// -----------------------------------------------------------------------------

export const INTERVIEW_TYPES = [
  "TECHNICAL",
  "HR",
  "BEHAVIORAL",
  "MANAGERIAL",
  "FULLSTACK",
  "DATA_AI",
  "CUSTOM",
] as const;

export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const NEXT_ACTIONS = [
  "FOLLOW_UP",
  "GO_DEEPER",
  "EXPLORE",
  "NEW_TOPIC",
  "CONCLUDE",
] as const;

export type NextAction = (typeof NEXT_ACTIONS)[number];

export const PlanTopicSchema = z.object({
  name: z.string().min(1),
  why: z.string().min(1),
  targetDifficulty: z.number().min(1).max(5),
  fromResume: z.boolean(),
});

export const OpeningQuestionSchema = z.object({
  question: z.string().min(1),
  topic: z.string().min(1),
  difficulty: z.number().min(1).max(5),
  competency: z.string().min(1),
});

export const InterviewPlanSchema = z.object({
  topics: z.array(PlanTopicSchema).min(5).max(8),
  openingQuestion: OpeningQuestionSchema,
  focusAreas: z.array(z.string()),
});

export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;
export type PlanTopic = z.infer<typeof PlanTopicSchema>;

export const AnswerEvaluationSchema = z.object({
  score: z.number().min(0).max(100),
  competency: z.string().min(1),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  redFlags: z.array(z.string()),
  reasoning: z.string().min(20),
});

export const NextQuestionSchema = z.object({
  question: z.string().min(1),
  topic: z.string().min(1),
  difficulty: z.number().min(1).max(5),
  competency: z.string().min(1),
});

export const TurnResultSchema = z
  .object({
    answerEvaluation: AnswerEvaluationSchema,
    nextAction: z.enum(NEXT_ACTIONS),
    actionReasoning: z.string().min(1),
    nextQuestion: NextQuestionSchema.nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.nextAction === "CONCLUDE" && val.nextQuestion != null) {
      ctx.addIssue({
        code: "custom",
        message: "nextQuestion must be null when nextAction is CONCLUDE",
        path: ["nextQuestion"],
      });
    }
    if (val.nextAction !== "CONCLUDE" && val.nextQuestion == null) {
      ctx.addIssue({
        code: "custom",
        message: "nextQuestion is required unless nextAction is CONCLUDE",
        path: ["nextQuestion"],
      });
    }
  });

export type TurnResult = z.infer<typeof TurnResultSchema>;
export type AnswerEvaluation = z.infer<typeof AnswerEvaluationSchema>;

export const FinalDimensionsSchema = z.object({
  technicalKnowledge: z.number().min(0).max(100),
  problemSolving: z.number().min(0).max(100),
  communication: z.number().min(0).max(100),
  roleKnowledge: z.number().min(0).max(100),
  behavioral: z.number().min(0).max(100),
  confidenceClarity: z.number().min(0).max(100),
});

export const ResumeValidationItemSchema = z.object({
  claim: z.string().min(1),
  verdict: z.enum(["VALIDATED", "PARTIAL", "NOT_VALIDATED", "CONTRADICTED"]),
  evidence: z.string().min(1),
});

export const FinalResultSchema = z.object({
  overall: z.number().min(0).max(100),
  dimensions: FinalDimensionsSchema,
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  resumeValidation: z.array(ResumeValidationItemSchema),
  recommendation: z.enum(["STRONG_YES", "YES", "MAYBE", "NO", "STRONG_NO"]),
  reasoning: z.string().min(100),
});

export type FinalResult = z.infer<typeof FinalResultSchema>;

export type TopicCoverage = {
  name: string;
  avgScore: number;
};

/** Updated in code only — never by the LLM. */
export type AdaptiveState = {
  currentTopicIndex: number;
  questionsAsked: number;
  followUpsOnCurrentTopic: number;
  topicsCovered: TopicCoverage[];
  difficulty: number;
  concluded: boolean;
};

export type TurnRecord = {
  sequence: number;
  question: string;
  topic: string;
  difficulty: number;
  answerText: string;
  score: number;
};

export const MAX_FOLLOW_UPS_PER_TOPIC = 2;

// -----------------------------------------------------------------------------
// Adaptive state helpers (code-enforced)
// -----------------------------------------------------------------------------

export function initialAdaptiveState(openingDifficulty = 3): AdaptiveState {
  return {
    currentTopicIndex: 0,
    questionsAsked: 0,
    followUpsOnCurrentTopic: 0,
    topicsCovered: [],
    difficulty: openingDifficulty,
    concluded: false,
  };
}

export function mapDifficultyToEnum(
  difficulty: number,
): "EASY" | "MEDIUM" | "HARD" {
  if (difficulty <= 2) return "EASY";
  if (difficulty >= 4) return "HARD";
  return "MEDIUM";
}

/**
 * Apply model turn result + hard rules (follow-up cap, maxQuestions, topic order).
 * Returns the enforced TurnResult and next AdaptiveState.
 */
export function enforceTurnRules(params: {
  modelResult: TurnResult;
  state: AdaptiveState;
  plan: InterviewPlan;
  maxQuestions: number;
  lastAnswerText: string;
}): { result: TurnResult; nextState: AdaptiveState } {
  const { modelResult, state, plan, maxQuestions, lastAnswerText } = params;
  let action = modelResult.nextAction;
  let nextQuestion = modelResult.nextQuestion;
  let actionReasoning = modelResult.actionReasoning;
  const evaluation = { ...modelResult.answerEvaluation };

  const questionsAskedAfter = state.questionsAsked + 1;
  const trimmed = lastAnswerText.trim();
  const isNonAnswer =
    trimmed.length < 8 ||
    /^(i\s*don'?t\s*know|idk|n\/?a|no idea|pass)\.?$/i.test(trimmed);

  if (isNonAnswer) {
    evaluation.score = Math.min(evaluation.score, 20);
    if (state.followUpsOnCurrentTopic < MAX_FOLLOW_UPS_PER_TOPIC) {
      action = "FOLLOW_UP";
      actionReasoning =
        "Non-answer detected — one follow-up allowed, then move on.";
    } else {
      action = "NEW_TOPIC";
      actionReasoning =
        "Non-answer after follow-up cap — advancing to a new topic.";
    }
  }

  if (action === "GO_DEEPER" && (isNonAnswer || evaluation.score < 50)) {
    action = "FOLLOW_UP";
    actionReasoning =
      "Weak/non-answer cannot GO_DEEPER — converted to FOLLOW_UP.";
  }

  if (
    action === "FOLLOW_UP" &&
    state.followUpsOnCurrentTopic >= MAX_FOLLOW_UPS_PER_TOPIC
  ) {
    action = "NEW_TOPIC";
    actionReasoning =
      "Follow-up cap (2) reached — forcing NEW_TOPIC.";
  }

  if (questionsAskedAfter >= maxQuestions) {
    action = "CONCLUDE";
    nextQuestion = null;
    actionReasoning = `maxQuestions (${maxQuestions}) reached — forcing CONCLUDE.`;
  }

  if (action === "CONCLUDE") {
    nextQuestion = null;
  } else if (!nextQuestion) {
    // Model omitted question — synthesize from plan
    const idx = Math.min(state.currentTopicIndex + 1, plan.topics.length - 1);
    const topic = plan.topics[idx] ?? plan.topics[0];
    nextQuestion = {
      question: `Tell me more about your experience with ${topic.name}.`,
      topic: topic.name,
      difficulty: topic.targetDifficulty,
      competency: topic.name,
    };
    actionReasoning = `${actionReasoning} (fallback question from plan)`;
  }

  if (action === "NEW_TOPIC" && nextQuestion) {
    const nextIdx = Math.min(
      state.currentTopicIndex + 1,
      Math.max(0, plan.topics.length - 1),
    );
    const planned = plan.topics[nextIdx];
    if (planned && nextQuestion.topic !== planned.name) {
      // Prefer plan topic order when model drifts
      nextQuestion = {
        ...nextQuestion,
        topic: planned.name,
        difficulty: planned.targetDifficulty,
      };
      actionReasoning = `${actionReasoning} (aligned to plan topic: ${planned.name})`;
    }
  }

  const currentTopicName =
    plan.topics[state.currentTopicIndex]?.name ??
    modelResult.answerEvaluation.competency;

  let followUps = state.followUpsOnCurrentTopic;
  let topicIndex = state.currentTopicIndex;
  const topicsCovered = [...state.topicsCovered];

  const bumpTopicScore = () => {
    const existing = topicsCovered.find((t) => t.name === currentTopicName);
    if (existing) {
      existing.avgScore = Math.round((existing.avgScore + evaluation.score) / 2);
    } else {
      topicsCovered.push({ name: currentTopicName, avgScore: evaluation.score });
    }
  };

  if (action === "FOLLOW_UP") {
    followUps += 1;
  } else if (action === "NEW_TOPIC") {
    bumpTopicScore();
    topicIndex = Math.min(topicIndex + 1, Math.max(0, plan.topics.length - 1));
    followUps = 0;
  } else if (action === "GO_DEEPER" || action === "EXPLORE") {
    bumpTopicScore();
    followUps = 0;
  } else if (action === "CONCLUDE") {
    bumpTopicScore();
  }

  const nextState: AdaptiveState = {
    currentTopicIndex: topicIndex,
    questionsAsked: questionsAskedAfter,
    followUpsOnCurrentTopic: followUps,
    topicsCovered,
    difficulty: nextQuestion?.difficulty ?? state.difficulty,
    concluded: action === "CONCLUDE",
  };

  const result: TurnResult = {
    answerEvaluation: evaluation,
    nextAction: action,
    actionReasoning,
    nextQuestion: action === "CONCLUDE" ? null : nextQuestion,
  };

  return { result, nextState };
}

export function mapFinalRecommendation(
  rec: FinalResult["recommendation"],
): AIRecommendation {
  return rec;
}

// -----------------------------------------------------------------------------
// Context builders
// -----------------------------------------------------------------------------

export function buildTurnContext(params: {
  plan: InterviewPlan;
  state: AdaptiveState;
  turns: TurnRecord[];
  maxQuestions: number;
  interviewType: string;
  jobTitle: string;
}): string {
  const recent = params.turns.slice(-6);
  const earlier = params.turns.slice(0, Math.max(0, params.turns.length - 6));

  const earlierSummaries = earlier.map(
    (t) =>
      `#${t.sequence} [${t.topic}] score=${t.score} difficulty=${t.difficulty}`,
  );

  const lastIdx = recent.length - 1;
  const recentBlock = recent.map((t, i) => {
    if (i === lastIdx) {
      return {
        sequence: t.sequence,
        topic: t.topic,
        difficulty: t.difficulty,
        question: t.question,
        answer: t.answerText,
        score: null,
        note: "this answer is not yet scored — you are scoring it now",
      };
    }
    return {
      sequence: t.sequence,
      topic: t.topic,
      difficulty: t.difficulty,
      question: t.question,
      answer: t.answerText,
      score: t.score,
    };
  });

  return JSON.stringify(
    {
      interviewType: params.interviewType,
      jobTitle: params.jobTitle,
      maxQuestions: params.maxQuestions,
      questionsAsked: params.state.questionsAsked,
      adaptiveState: params.state,
      plan: params.plan,
      earlierTurnSummaries: earlierSummaries,
      recentTurnsVerbatim: recentBlock,
      lastAnswer: recent[recent.length - 1]?.answerText ?? "",
    },
    null,
    2,
  );
}

const TURN_RESULT_JSON_SCHEMA = `Return JSON with EXACTLY these keys and no others:
{ "answerEvaluation": { "score": <0-100>, "competency": string,
  "strengths": string[], "weaknesses": string[],
  "redFlags": string[], "reasoning": string (min 20 chars) },
  "nextAction": "FOLLOW_UP"|"GO_DEEPER"|"EXPLORE"|"NEW_TOPIC"|"CONCLUDE",
  "actionReasoning": string,
  "nextQuestion": { "question": string, "topic": string,
    "difficulty": <1-5>, "competency": string } or null (null ONLY
    when nextAction is "CONCLUDE") }`;

const FINAL_RESULT_JSON_SCHEMA = `{ "overall": <0-100>, "dimensions": { "technicalKnowledge":
  <0-100>, "problemSolving": <0-100>, "communication": <0-100>,
  "roleKnowledge": <0-100>, "behavioral": <0-100>,
  "confidenceClarity": <0-100> }, "strengths": string[],
  "weaknesses": string[], "resumeValidation": [{ "claim": string,
  "verdict": "VALIDATED"|"PARTIAL"|"NOT_VALIDATED"|"CONTRADICTED",
  "evidence": string }], "recommendation": "STRONG_YES"|"YES"|
  "MAYBE"|"NO"|"STRONG_NO", "reasoning": string (min 100 chars) }`;

// -----------------------------------------------------------------------------
// LLM calls
// -----------------------------------------------------------------------------

const PLAN_SYSTEM = `You are designing an adaptive interview plan for a self-hosted ATS.
Return ONLY valid JSON matching the schema.
Rules:
- Produce 5-8 topics mixing: (1) JD requirements, (2) specific resume projects/claims with fromResume:true, (3) screening focusAreas/gaps.
- openingQuestion must be conversational, one question, role-relevant.
- Never invent resume facts — only use provided resume text.
- Do not include scores or hiring decisions.`;

export async function generatePlan(params: {
  job: Pick<Job, "title" | "description" | "skills" | "experienceMin" | "experienceMax" | "screeningCriteria">;
  candidate: {
    firstName: string;
    lastName: string;
    summary?: string | null;
    skills: string[];
    experience: number;
  };
  resumeText: string;
  interviewType: InterviewType;
  screeningFocus?: ScreeningResult | null;
}): Promise<{ plan: InterviewPlan; model: string; raw: unknown }> {
  const focusFromScreen =
    params.screeningFocus?.missingRequirements?.length ||
    params.screeningFocus?.concerns?.length
      ? [
          ...(params.screeningFocus.missingRequirements ?? []),
          ...(params.screeningFocus.concerns ?? []),
        ]
      : [];

  const user = [
    `Interview type: ${params.interviewType}`,
    `Job title: ${params.job.title}`,
    `Job description:\n${params.job.description}`,
    `Job skills: ${params.job.skills.join(", ")}`,
    `Experience range: ${params.job.experienceMin}${params.job.experienceMax != null ? `–${params.job.experienceMax}` : "+"} years`,
    `Screening criteria: ${JSON.stringify(params.job.screeningCriteria ?? {})}`,
    `Latest screening focusAreas/gaps: ${JSON.stringify(focusFromScreen)}`,
    `Candidate: ${params.candidate.firstName} ${params.candidate.lastName}`,
    `Candidate skills: ${params.candidate.skills.join(", ")}`,
    `Candidate experience years: ${params.candidate.experience}`,
    `Candidate summary: ${params.candidate.summary ?? "(none)"}`,
    `Resume text:\n${params.resumeText.slice(0, 6000) || "(none)"}`,
    "",
    "Return JSON: { topics: [{ name, why, targetDifficulty 1-5, fromResume }], openingQuestion: { question, topic, difficulty, competency }, focusAreas: string[] }",
  ].join("\n");

  const { data, model, raw } = await chatJSON(PLAN_SYSTEM, user, InterviewPlanSchema);

  // Merge screening focus into focusAreas if model omitted them
  const focusAreas = Array.from(
    new Set([...data.focusAreas, ...focusFromScreen].filter(Boolean)),
  );

  return {
    plan: { ...data, focusAreas },
    model,
    raw,
  };
}

const TURN_SYSTEM = `You are an adaptive interviewer for a self-hosted ATS (text-only).
Return ONLY valid JSON for TurnResult.
You must BOTH score the latest answer AND choose the next action.

nextAction values:
- FOLLOW_UP: probe weak/vague/incomplete answer
- GO_DEEPER: strong answer → harder question same topic
- EXPLORE: candidate mentioned something interesting worth probing
- NEW_TOPIC: topic covered enough → move on
- CONCLUDE: interview plan complete or max questions reached

Scoring anchors (be strict, not generous):
- 90+: expert with concrete evidence
- 70-89: solid competent answer
- 50-69: partial/shallow
- <50: weak/wrong/evasive
- empty or "I don't know": score <= 20

Rules:
- Non-answers: FOLLOW_UP once, then NEW_TOPIC — never GO_DEEPER on non-answers.
- One question at a time, conversational tone; may reference candidate's own words.
- Never reveal scores to the candidate in the question text.
- nextQuestion is null ONLY when nextAction is CONCLUDE.
- Force CONCLUDE when questionsAsked+1 >= maxQuestions.`;

export async function nextTurn(params: {
  plan: InterviewPlan;
  state: AdaptiveState;
  turns: TurnRecord[];
  maxQuestions: number;
  interviewType: string;
  jobTitle: string;
}): Promise<{ result: TurnResult; model: string; raw: unknown }> {
  if (params.turns.length === 0) {
    throw new AIError("VALIDATION", "nextTurn requires at least one answered turn");
  }

  const user = [
    "Evaluate the LATEST answer in recentTurnsVerbatim and choose the next action.",
    buildTurnContext(params),
    TURN_RESULT_JSON_SCHEMA,
  ].join("\n\n");

  const { data, model, raw } = await chatJSON(TURN_SYSTEM, user, TurnResultSchema);

  const lastAnswer = params.turns[params.turns.length - 1].answerText;
  const enforced = enforceTurnRules({
    modelResult: data,
    state: params.state,
    plan: params.plan,
    maxQuestions: params.maxQuestions,
    lastAnswerText: lastAnswer,
  });

  return {
    result: enforced.result,
    model,
    raw: {
      modelRaw: raw,
      enforcedState: enforced.nextState,
      actionReasoning: enforced.result.actionReasoning,
    },
  };
}

/** Like nextTurn but also returns the code-updated adaptive state. */
export async function nextTurnWithState(params: {
  plan: InterviewPlan;
  state: AdaptiveState;
  turns: TurnRecord[];
  maxQuestions: number;
  interviewType: string;
  jobTitle: string;
}): Promise<{
  result: TurnResult;
  nextState: AdaptiveState;
  model: string;
  raw: unknown;
}> {
  if (params.turns.length === 0) {
    throw new AIError("VALIDATION", "nextTurn requires at least one answered turn");
  }

  const user = [
    "Evaluate the LATEST answer in recentTurnsVerbatim and choose the next action.",
    buildTurnContext(params),
    TURN_RESULT_JSON_SCHEMA,
  ].join("\n\n");

  const { data, model, raw } = await chatJSON(TURN_SYSTEM, user, TurnResultSchema);
  const lastAnswer = params.turns[params.turns.length - 1].answerText;
  const enforced = enforceTurnRules({
    modelResult: data,
    state: params.state,
    plan: params.plan,
    maxQuestions: params.maxQuestions,
    lastAnswerText: lastAnswer,
  });

  return {
    result: enforced.result,
    nextState: enforced.nextState,
    model,
    raw,
  };
}

const FINAL_SYSTEM = `You are producing an advisory final interview evaluation for recruiters.
Return ONLY valid JSON matching FinalResult.
Rules:
- overall and each dimension are 0-100.
- resumeValidation: check concrete resume claims against interview answers.
  verdict: VALIDATED | PARTIAL | NOT_VALIDATED | CONTRADICTED with evidence.
- recommendation: STRONG_YES | YES | MAYBE | NO | STRONG_NO (advisory only).
- reasoning: at least 100 characters, cite specific answers.
- Do not invent facts not present in the transcript or resume.`;

export async function finalEvaluation(params: {
  plan: InterviewPlan;
  interviewType: string;
  jobTitle: string;
  jobDescription: string;
  resumeText: string;
  turns: TurnRecord[];
  adaptiveState: AdaptiveState;
}): Promise<{ result: FinalResult; model: string; raw: unknown }> {
  const user = [
    JSON.stringify(
      {
        interviewType: params.interviewType,
        jobTitle: params.jobTitle,
        jobDescription: params.jobDescription,
        plan: params.plan,
        adaptiveState: params.adaptiveState,
        resumeText: params.resumeText.slice(0, 5000),
        transcript: params.turns.map((t) => ({
          sequence: t.sequence,
          topic: t.topic,
          difficulty: t.difficulty,
          question: t.question,
          answer: t.answerText,
          score: t.score,
        })),
      },
      null,
      2,
    ),
    FINAL_RESULT_JSON_SCHEMA,
  ].join("\n\n");

  const { data, model, raw } = await chatJSON(FINAL_SYSTEM, user, FinalResultSchema);

  if (!data.reasoning?.trim() || data.reasoning.trim().length < 100) {
    throw new AIError("VALIDATION", "Final evaluation reasoning too short");
  }

  return { result: data, model, raw };
}
