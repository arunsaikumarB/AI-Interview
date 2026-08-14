import { z } from "zod";
import type { AIRecommendation, Job } from "@prisma/client";
import { AIError, chatJSON } from "@/lib/ai/ollama";
import {
  coerceDifficulty,
  coerceStringArray,
  ensureMinText,
} from "@/lib/ai/llm-coerce";
import type { ScreeningResult } from "@/lib/ai/screening";
import {
  decideNextTurn,
  inferInterviewType,
  sanitizePlanForJob,
  type JobInterviewScope,
} from "@/lib/ai/interview-guard";

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

const InterviewPlanShape = z.object({
  topics: z.array(PlanTopicSchema).min(4).max(8),
  openingQuestion: OpeningQuestionSchema,
  focusAreas: z.array(z.string()),
});

function coercePlanTopic(raw: unknown): {
  name: string;
  why: string;
  targetDifficulty: number;
  fromResume: boolean;
} | null {
  if (!raw || typeof raw !== "object") {
    if (typeof raw === "string" && raw.trim()) {
      return {
        name: raw.trim().slice(0, 80),
        why: "Derived from job/resume context",
        targetDifficulty: 3,
        fromResume: false,
      };
    }
    return null;
  }
  const o = raw as Record<string, unknown>;
  const name =
    typeof o.name === "string" && o.name.trim()
      ? o.name.trim()
      : typeof o.topic === "string" && o.topic.trim()
        ? o.topic.trim()
        : "";
  if (!name) return null;
  const why =
    typeof o.why === "string" && o.why.trim()
      ? o.why.trim()
      : typeof o.reason === "string" && o.reason.trim()
        ? o.reason.trim()
        : "Relevant to role assessment";
  return {
    name,
    why,
    targetDifficulty: coerceDifficulty(o.targetDifficulty ?? o.difficulty, 3),
    fromResume: Boolean(o.fromResume),
  };
}

/** Lenient plan parse — pads/coerces common local-LLM quirks. */
export const InterviewPlanSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };

  const topicsRaw = Array.isArray(o.topics) ? o.topics : [];
  let topics = topicsRaw
    .map(coercePlanTopic)
    .filter((t): t is NonNullable<typeof t> => t != null);

  const defaults = [
    {
      name: "Role fundamentals",
      why: "Baseline role fit",
      targetDifficulty: 2,
      fromResume: false,
    },
    {
      name: "Core technical skills",
      why: "Required by job description",
      targetDifficulty: 3,
      fromResume: false,
    },
    {
      name: "Recent experience",
      why: "Validate hands-on delivery",
      targetDifficulty: 3,
      fromResume: true,
    },
    {
      name: "Problem solving",
      why: "Assess approach under ambiguity",
      targetDifficulty: 3,
      fromResume: false,
    },
  ];
  while (topics.length < 4) {
    topics.push(defaults[topics.length]!);
  }
  topics = topics.slice(0, 8);
  o.topics = topics;

  if (!o.openingQuestion || typeof o.openingQuestion !== "object") {
    o.openingQuestion = {
      question: `Tell me about your experience most relevant to this role.`,
      topic: topics[0]!.name,
      difficulty: 2,
      competency: "Communication",
    };
  } else {
    const q = { ...(o.openingQuestion as Record<string, unknown>) };
    q.question = ensureMinText(
      q.question,
      1,
      `Tell me about your experience most relevant to this role.`,
    );
    q.topic = ensureMinText(q.topic, 1, topics[0]!.name);
    q.competency = ensureMinText(q.competency, 1, "Communication");
    q.difficulty = coerceDifficulty(q.difficulty, 2);
    o.openingQuestion = q;
  }

  o.focusAreas = coerceStringArray(o.focusAreas, { max: 12 });
  return o;
}, InterviewPlanShape);

export type InterviewPlan = z.infer<typeof InterviewPlanShape>;
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
  priorQuestions?: string[];
  job?: JobInterviewScope;
}): { result: TurnResult; nextState: AdaptiveState } {
  return decideNextTurn({
    state: params.state,
    plan: params.plan,
    maxQuestions: params.maxQuestions,
    lastAnswerText: params.lastAnswerText,
    priorQuestions: params.priorQuestions ?? [],
    job: params.job ?? {
      title: "the role",
      description: "",
      skills: [],
      interviewType: "TECHNICAL",
    },
    modelResult: params.modelResult,
  });
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
  jobDescription?: string;
  jobSkills?: string[];
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
      jobDescription: (params.jobDescription ?? "").slice(0, 2500),
      jobSkills: params.jobSkills ?? [],
      maxQuestions: params.maxQuestions,
      questionsAsked: params.state.questionsAsked,
      adaptiveState: params.state,
      plan: params.plan,
      alreadyAskedQuestions: params.turns.map((t) => t.question),
      earlierTurnSummaries: earlierSummaries,
      recentTurnsVerbatim: recentBlock,
      lastAnswer: recent[recent.length - 1]?.answerText ?? "",
      rules: [
        "NEVER repeat or rephrase a question in alreadyAskedQuestions.",
        "FOLLOW_UP must be a different probe, not the same question again.",
        "Ask only about the job title, job description, and job skills — not resume-only tools (e.g. Figma) unless those tools are in the JD.",
      ],
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
- Topics MUST come from the JOB title, job description, and job skills. Resume text is only for validating claims ABOUT those job skills.
- Do NOT create topics from resume-only skills that are absent from the JD (example: Figma / UX design tools for a Full-Stack Engineer).
- Produce 4-6 topics: JD requirements first, then at most 1-2 resume projects that map to JD skills (fromResume:true), then screening gaps that are still on-JD.
- topics MUST be a JSON array of objects with name, why, targetDifficulty (1-5), fromResume (boolean).
- openingQuestion must be conversational, one question, and on-role for the job title.
- focusAreas MUST be a JSON array of strings, all on-JD.
- Never invent resume facts — only use provided resume text.
- Do not include scores or hiring decisions.`;

export function buildFallbackInterviewPlan(params: {
  jobTitle: string;
  skills: string[];
  focusAreas?: string[];
  jobDescription?: string;
  interviewType?: string;
}): InterviewPlan {
  const job: JobInterviewScope = {
    title: params.jobTitle,
    description: params.jobDescription ?? "",
    skills: params.skills,
    interviewType: params.interviewType ?? "TECHNICAL",
  };
  const skillTopics = params.skills.slice(0, 4).map((skill) => ({
    name: skill,
    why: `Required or preferred skill for ${params.jobTitle}`,
    targetDifficulty: 3,
    fromResume: false,
  }));

  const topics = [
    {
      name: "Role overview",
      why: `Baseline fit for ${params.jobTitle}`,
      targetDifficulty: 2,
      fromResume: false,
    },
    ...skillTopics,
    {
      name: "Recent project deep-dive",
      why: "Validate hands-on delivery from resume",
      targetDifficulty: 3,
      fromResume: true,
    },
    {
      name: "Problem solving",
      why: "Assess structured thinking",
      targetDifficulty: 3,
      fromResume: false,
    },
  ].slice(0, 6);

  while (topics.length < 4) {
    topics.push({
      name: `Competency ${topics.length + 1}`,
      why: "Cover remaining interview dimensions",
      targetDifficulty: 3,
      fromResume: false,
    });
  }

  return sanitizePlanForJob(
    {
      topics,
      openingQuestion: {
        question: `Tell me about your experience most relevant to the ${params.jobTitle} role.`,
        topic: topics[0]!.name,
        difficulty: 2,
        competency: "Communication",
      },
      focusAreas: (params.focusAreas ?? []).slice(0, 12),
    },
    job,
  );
}

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
  const interviewType = inferInterviewType(
    params.job.title,
    params.interviewType,
  );
  const jobScope: JobInterviewScope = {
    title: params.job.title,
    description: params.job.description,
    skills: params.job.skills,
    interviewType,
  };
  const focusFromScreen =
    params.screeningFocus?.missingRequirements?.length ||
    params.screeningFocus?.concerns?.length
      ? [
          ...(params.screeningFocus.missingRequirements ?? []),
          ...(params.screeningFocus.concerns ?? []),
        ]
      : [];

  const user = [
    `Interview type: ${interviewType}`,
    `Job title: ${params.job.title}`,
    `Job description:\n${params.job.description}`,
    `Job skills: ${params.job.skills.join(", ")}`,
    `Experience range: ${params.job.experienceMin}${params.job.experienceMax != null ? `–${params.job.experienceMax}` : "+"} years`,
    `Screening criteria: ${JSON.stringify(params.job.screeningCriteria ?? {})}`,
    `Latest screening focusAreas/gaps (keep only if they match the JD): ${JSON.stringify(focusFromScreen)}`,
    `Candidate: ${params.candidate.firstName} ${params.candidate.lastName}`,
    `Candidate skills (do NOT turn these into topics unless they also appear in job skills/JD): ${params.candidate.skills.join(", ")}`,
    `Candidate experience years: ${params.candidate.experience}`,
    `Candidate summary: ${params.candidate.summary ?? "(none)"}`,
    `Resume text (use only to probe JD-relevant claims):\n${params.resumeText.slice(0, 4000) || "(none)"}`,
    "",
    "Return JSON: { topics: [{ name, why, targetDifficulty 1-5, fromResume }], openingQuestion: { question, topic, difficulty, competency }, focusAreas: string[] }",
  ].join("\n");

  try {
    const { data, model, raw } = await chatJSON(
      PLAN_SYSTEM,
      user,
      InterviewPlanSchema,
      {
        temperature: 0.1,
        numPredict: 900,
        jsonSchema: z.toJSONSchema(InterviewPlanShape) as Record<
          string,
          unknown
        >,
      },
    );

    const focusAreas = Array.from(
      new Set([...data.focusAreas, ...focusFromScreen].filter(Boolean)),
    );

    return {
      plan: sanitizePlanForJob({ ...data, focusAreas }, jobScope),
      model,
      raw,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "plan generation failed";
    console.warn("[generatePlan] using template fallback:", message);
    const plan = buildFallbackInterviewPlan({
      jobTitle: params.job.title,
      skills: params.job.skills,
      jobDescription: params.job.description,
      interviewType,
      focusAreas: focusFromScreen,
    });
    return {
      plan,
      model: "fallback-template",
      raw: { fallback: true, error: message },
    };
  }
}

const TURN_SYSTEM = `You are an adaptive interviewer for a self-hosted ATS (text-only).
Return ONLY valid JSON for TurnResult.
You must BOTH score the latest answer AND choose the next action.

nextAction values:
- FOLLOW_UP: probe weak/vague/incomplete answer with a DIFFERENT question
- GO_DEEPER: strong answer → harder question same topic (never a rephrase)
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
- NEVER repeat or rephrase a question already in alreadyAskedQuestions.
- FOLLOW_UP must ask something new (trade-offs, ownership, failure mode) — not the same prompt again.
- Stay on the job title / JD / job skills. Do not ask about design tools (Figma, Photoshop, Sketch, etc.) unless they appear in jobSkills or jobDescription.
- Non-answers: FOLLOW_UP once with a different probe, then NEW_TOPIC — never GO_DEEPER on non-answers.
- After a substantial answer, prefer GO_DEEPER or NEW_TOPIC — do not re-ask.
- One question at a time, conversational tone; may reference candidate's own words.
- Never reveal scores to the candidate in the question text.
- nextQuestion is null ONLY when nextAction is CONCLUDE.
- Force CONCLUDE when questionsAsked+1 >= maxQuestions.
- Keep answerEvaluation.reasoning and actionReasoning under 40 words. At most 2 short strings per array.`;

export type NextTurnParams = {
  plan: InterviewPlan;
  state: AdaptiveState;
  turns: TurnRecord[];
  maxQuestions: number;
  interviewType: string;
  jobTitle: string;
  jobDescription?: string;
  jobSkills?: string[];
};

function jobFromTurnParams(params: NextTurnParams): JobInterviewScope {
  return {
    title: params.jobTitle,
    description: params.jobDescription ?? "",
    skills: params.jobSkills ?? [],
    interviewType: params.interviewType,
  };
}

export async function nextTurn(params: NextTurnParams): Promise<{
  result: TurnResult;
  model: string;
  raw: unknown;
}> {
  const withState = await nextTurnWithState(params);
  return {
    result: withState.result,
    model: withState.model,
    raw: {
      modelRaw: withState.raw,
      enforcedState: withState.nextState,
      actionReasoning: withState.result.actionReasoning,
    },
  };
}

/** Like nextTurn but also returns the code-updated adaptive state. */
export async function nextTurnWithState(params: NextTurnParams): Promise<{
  result: TurnResult;
  nextState: AdaptiveState;
  model: string;
  raw: unknown;
}> {
  if (params.turns.length === 0) {
    throw new AIError("VALIDATION", "nextTurn requires at least one answered turn");
  }

  const lastAnswer = params.turns[params.turns.length - 1]!.answerText;
  const job = jobFromTurnParams(params);
  const priorQuestions = params.turns.map((t) => t.question);

  const fallback = () =>
    decideNextTurn({
      state: params.state,
      plan: params.plan,
      maxQuestions: params.maxQuestions,
      lastAnswerText: lastAnswer,
      lastTopic: params.turns[params.turns.length - 1]?.topic,
      priorQuestions,
      job,
      modelResult: null,
    });

  try {
    const user = [
      "Evaluate the LATEST answer in recentTurnsVerbatim and choose the next action.",
      buildTurnContext(params),
      TURN_RESULT_JSON_SCHEMA,
    ].join("\n\n");

    const { data, model, raw } = await chatJSON(
      TURN_SYSTEM,
      user,
      TurnResultSchema,
      {
        numPredict: 400,
        timeoutMs: 35_000,
        maxAttempts: 1,
      },
    );
    const enforced = enforceTurnRules({
      modelResult: data,
      state: params.state,
      plan: params.plan,
      maxQuestions: params.maxQuestions,
      lastAnswerText: lastAnswer,
      priorQuestions,
      job,
    });
    return {
      result: enforced.result,
      nextState: enforced.nextState,
      model,
      raw,
    };
  } catch (err) {
    console.warn(
      "[nextTurnWithState] using deterministic next question:",
      err instanceof Error ? err.message : err,
    );
    const enforced = fallback();
    return {
      result: enforced.result,
      nextState: enforced.nextState,
      model: "deterministic-guard",
      raw: { fallback: true },
    };
  }
}

const SCORE_SYSTEM = `You score one interview answer for recruiters in a self-hosted ATS.
Return ONLY JSON: { "score": 0-100, "competency": string, "strengths": string[],
"weaknesses": string[], "redFlags": string[], "reasoning": string (min 20 chars) }.
Be strict. Do not write a next question. Do not mention proctoring.`;

/** Recruiter-facing score — must not block the candidate on the next question. */
export async function evaluateAnswerOnly(params: {
  plan: InterviewPlan;
  interviewType: string;
  jobTitle: string;
  jobDescription: string;
  jobSkills: string[];
  turns: TurnRecord[];
}): Promise<{ evaluation: AnswerEvaluation; model: string; raw: unknown }> {
  if (params.turns.length === 0) {
    throw new AIError("VALIDATION", "evaluateAnswerOnly requires an answered turn");
  }
  const last = params.turns[params.turns.length - 1]!;
  const user = JSON.stringify(
    {
      jobTitle: params.jobTitle,
      jobDescription: params.jobDescription.slice(0, 2000),
      jobSkills: params.jobSkills,
      interviewType: params.interviewType,
      planTopics: params.plan.topics.map((t) => t.name),
      question: last.question,
      topic: last.topic,
      answer: last.answerText,
    },
    null,
    2,
  );

  const { data, model, raw } = await chatJSON(
    SCORE_SYSTEM,
    user,
    AnswerEvaluationSchema,
    {
      numPredict: 280,
      timeoutMs: 90_000,
      maxAttempts: 2,
    },
  );
  return { evaluation: data, model, raw };
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
