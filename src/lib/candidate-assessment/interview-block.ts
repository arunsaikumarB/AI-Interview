import { z } from "zod";
import type { AiAssistedBlueprint } from "@/lib/assessment/ai-schema";
import {
  COMPETENCY_SOURCES,
  QUESTION_SOURCES,
  QUESTION_TYPES,
  type AssessmentBlueprint,
} from "@/lib/assessment/types";

/**
 * V3.1 — validated V1/V2 question set carried inside InterviewSession.plan.
 *
 * The interview engine asks these questions (exact validated text) on each
 * new topic; follow-ups stay engine-generated. Staff-only: candidate routes
 * never return the plan. Never contains scores, proctoring or decisions.
 */

export const ASSESSMENT_INTEGRATION_VERSION = "assessment-integration-v3.1" as const;
export const MAX_ASSESSMENT_QUESTIONS = 20;

const EvidenceTextSchema = z.string().min(1).max(500);

export const AssessmentInterviewQuestionSchema = z
  .object({
    id: z.string().min(1).max(120),
    stageId: z.string().min(1).max(60),
    stageTitle: z.string().min(1).max(160),
    type: z.enum(QUESTION_TYPES),
    competencyId: z.string().min(1).max(80),
    competency: z.string().min(1).max(120),
    competencySource: z.enum(COMPETENCY_SOURCES),
    difficulty: z.number().int().min(1).max(5),
    text: z.string().min(10).max(800),
    source: z.enum(QUESTION_SOURCES),
    purpose: z.string().min(1).max(60),
    expectedEvidence: z.array(EvidenceTextSchema).min(1).max(8),
    rubric: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            description: z.string().min(1).max(400),
            weight: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(2)
      .max(6),
    jdEvidence: z.array(EvidenceTextSchema).max(8),
    resumeEvidence: z.array(EvidenceTextSchema).max(4),
    generationMode: z.enum(["AI_GENERATED", "DETERMINISTIC_FALLBACK"]),
  })
  .strict();
export type AssessmentInterviewQuestion = z.infer<typeof AssessmentInterviewQuestionSchema>;

export const GENERATION_STATUSES = ["FALLBACK_PENDING_AI", "AI_ASSISTED", "FALLBACK_ONLY"] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const AssessmentInterviewBlockSchema = z
  .object({
    source: z.literal("ASSESSMENT_BLUEPRINT"),
    integrationVersion: z.literal(ASSESSMENT_INTEGRATION_VERSION),
    engineVersion: z.string().min(1).max(60),
    aiLayerVersion: z.string().min(1).max(60).nullable(),
    blueprintGeneratedAt: z.string().min(1).max(40),
    jobId: z.string().min(1).max(64),
    applicationId: z.string().min(1).max(64),
    required: z.literal(true),
    generation: z
      .object({
        status: z.enum(GENERATION_STATUSES),
        total: z.number().int().min(0),
        aiGenerated: z.number().int().min(0),
        fallback: z.number().int().min(0),
        model: z.string().max(120).nullable(),
        upgradedAt: z.string().max(40).nullable(),
      })
      .strict(),
    questions: z.array(AssessmentInterviewQuestionSchema).min(1).max(MAX_ASSESSMENT_QUESTIONS),
  })
  .strict();
export type AssessmentInterviewBlock = z.infer<typeof AssessmentInterviewBlockSchema>;

type AnyBlueprint = AssessmentBlueprint | AiAssistedBlueprint;

function modeOf(q: AnyBlueprint["questions"][number]): AssessmentInterviewQuestion["generationMode"] {
  const mode = (q as { generationMode?: string }).generationMode;
  return mode === "AI_GENERATED" ? "AI_GENERATED" : "DETERMINISTIC_FALLBACK";
}

/**
 * Interview-askable questions from a V1 blueprint (deterministic wording =
 * the V2 fallback) or a V2 AI-assisted blueprint. Practical recommendations
 * are excluded — practical work is its own assessment component.
 */
export function buildInterviewBlock(
  blueprint: AnyBlueprint,
  generation: AssessmentInterviewBlock["generation"],
): AssessmentInterviewBlock | null {
  if (!blueprint.candidate) return null;
  const stageTitle = new Map(blueprint.plan.stages.map((s) => [s.id, s.title]));
  const competencySource = new Map(blueprint.competencies.map((c) => [c.id, c.source]));
  const questions: AssessmentInterviewQuestion[] = blueprint.questions
    .filter((q) => q.type !== "PRACTICAL_RECOMMENDATION")
    .slice(0, MAX_ASSESSMENT_QUESTIONS)
    .map((q) => ({
      id: q.id,
      stageId: q.stageId,
      stageTitle: (stageTitle.get(q.stageId) ?? q.stageId).slice(0, 160),
      type: q.type,
      competencyId: q.competencyId,
      competency: q.competency,
      competencySource: competencySource.get(q.competencyId) ?? "ROLE_STANDARD",
      difficulty: q.difficulty,
      text: q.text,
      source: q.source,
      purpose: q.purpose,
      expectedEvidence: q.expectedEvidence.slice(0, 8),
      rubric: q.rubric.map((r) => ({ name: r.name, description: r.description, weight: r.weight })),
      jdEvidence: q.sourceEvidence.jd.map((e) => e.text.slice(0, 500)).slice(0, 8),
      resumeEvidence: q.sourceEvidence.resume.map((e) => e.quote.slice(0, 500)).slice(0, 4),
      generationMode: modeOf(q),
    }));
  if (questions.length === 0) return null;

  const block: AssessmentInterviewBlock = {
    source: "ASSESSMENT_BLUEPRINT",
    integrationVersion: ASSESSMENT_INTEGRATION_VERSION,
    engineVersion: blueprint.engineVersion,
    aiLayerVersion: (blueprint as AiAssistedBlueprint).aiLayerVersion ?? null,
    blueprintGeneratedAt: blueprint.generatedAt,
    jobId: blueprint.job.id,
    applicationId: blueprint.candidate.applicationId,
    required: true,
    generation: {
      ...generation,
      total: questions.length,
      aiGenerated: questions.filter((q) => q.generationMode === "AI_GENERATED").length,
      fallback: questions.filter((q) => q.generationMode !== "AI_GENERATED").length,
    },
    questions,
  };
  return AssessmentInterviewBlockSchema.parse(block);
}

/** Reads the block from a stored plan; anything malformed is treated as "no assessment block". */
export function readInterviewBlock(plan: unknown): AssessmentInterviewBlock | null {
  if (!plan || typeof plan !== "object") return null;
  const parsed = AssessmentInterviewBlockSchema.safeParse((plan as { assessment?: unknown }).assessment);
  return parsed.success ? parsed.data : null;
}

type PlanTopicShape = { name: string; why: string; targetDifficulty: number; fromResume: boolean };

/**
 * Interview plan seeded from the block: topics are the blueprint competencies
 * in question order (so engine follow-ups inherit the competency name) and the
 * opening question is the first validated question.
 */
export function planFromInterviewBlock(
  block: AssessmentInterviewBlock,
  blueprint: AnyBlueprint,
): {
  topics: PlanTopicShape[];
  openingQuestion: { question: string; topic: string; difficulty: number; competency: string };
  focusAreas: string[];
  assessment: AssessmentInterviewBlock;
} {
  const byId = new Map(blueprint.competencies.map((c) => [c.id, c]));
  const strongResume = new Set(
    blueprint.resume.byCompetency.filter((r) => r.strength === "STRONG").map((r) => r.competencyId),
  );
  const topics: PlanTopicShape[] = [];
  const seen = new Set<string>();
  const addTopic = (id: string, name: string, difficulty: number) => {
    if (seen.has(name) || topics.length >= 8) return;
    seen.add(name);
    const c = byId.get(id);
    topics.push({
      name,
      why: (c?.explanation ?? `Blueprint competency for ${blueprint.job.title}`).slice(0, 300),
      targetDifficulty: difficulty,
      fromResume: strongResume.has(id),
    });
  };
  for (const q of block.questions) {
    const max = Math.max(...block.questions.filter((x) => x.competency === q.competency).map((x) => x.difficulty));
    addTopic(q.competencyId, q.competency, max);
  }
  for (const c of blueprint.competencies) {
    if (topics.length >= 4) break;
    addTopic(c.id, c.name, 3);
  }
  const padding = ["Role fundamentals", "Core technical skills", "Recent experience", "Problem solving"];
  for (const name of padding) {
    if (topics.length >= 4) break;
    if (!seen.has(name)) {
      seen.add(name);
      topics.push({ name, why: "Baseline role coverage", targetDifficulty: 3, fromResume: false });
    }
  }

  const first = block.questions[0]!;
  return {
    topics,
    openingQuestion: {
      question: first.text,
      topic: first.competency,
      difficulty: first.difficulty,
      competency: first.competency,
    },
    focusAreas: Array.from(new Set(block.questions.map((q) => q.competency))).slice(0, 12),
    assessment: block,
  };
}

/** Enough turns for every validated question plus some engine follow-ups. */
export function interviewQuestionBudget(block: AssessmentInterviewBlock, requested: number | undefined): number {
  const n = block.questions.length;
  const floor = Math.min(30, n);
  const fallback = Math.min(30, Math.max(12, n + Math.ceil(n / 2)));
  return Math.min(30, Math.max(floor, requested ?? fallback));
}
