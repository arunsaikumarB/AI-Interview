import { z } from "zod";
import {
  QUESTION_TYPES,
  type AssessmentBlueprint,
  type QuestionSpec,
  type TraceabilityEntry,
} from "./types";

/**
 * Assessment Engine V2 — contract for model-written question wording.
 *
 * V1 stays authoritative for role, competency, type, difficulty, evidence,
 * stage and rubric criteria. The model only supplies wording, which must pass
 * this schema and the V2 guardrails before it replaces the V1 text.
 */

export const AI_LAYER_VERSION = "assessment-engine-v2-ai" as const;

export const GENERATION_MODES = ["DETERMINISTIC", "AI_GENERATED", "DETERMINISTIC_FALLBACK"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const AI_FAILURE_TYPES = [
  "MODEL_FAILURE",
  "TIMEOUT",
  "INVALID_JSON",
  "SCHEMA_VALIDATION_FAILURE",
  "GUARDRAIL_FAILURE",
] as const;
export type AiFailureType = (typeof AI_FAILURE_TYPES)[number];

const RubricItemSchema = z
  .object({
    criterion: z.string().min(1).max(120),
    weight: z.number().int().min(1).max(100),
  })
  .strict();

export const AiQuestionOutputSchema = z
  .object({
    question: z
      .object({
        questionType: z.enum(QUESTION_TYPES),
        competency: z.string().min(1).max(120),
        difficulty: z.number().int().min(1).max(5),
        text: z.string().min(20).max(700),
        purpose: z.string().min(10).max(300),
        expectedEvidence: z.array(z.string().min(3).max(300)).min(1).max(6),
        followUpRules: z.array(z.string().min(3).max(300)).min(1).max(5),
        rubric: z.array(RubricItemSchema).min(2).max(6),
      })
      .strict(),
  })
  .strict();
export type AiQuestionOutput = z.infer<typeof AiQuestionOutputSchema>;

/**
 * JSON Schema sent to Ollama as the structured-output format, pinned to the
 * approved slot so the grammar itself cannot drift to another type,
 * competency or difficulty.
 */
export function aiQuestionJsonSchema(spec: Pick<QuestionSpec, "type" | "competency" | "difficulty">): Record<string, unknown> {
  const str = (min: number, max: number) => ({ type: "string", minLength: min, maxLength: max });
  const list = (min: number, max: number) => ({
    type: "array",
    items: str(3, 300),
    minItems: min,
    maxItems: max,
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["question"],
    properties: {
      question: {
        type: "object",
        additionalProperties: false,
        required: [
          "questionType",
          "competency",
          "difficulty",
          "text",
          "purpose",
          "expectedEvidence",
          "followUpRules",
          "rubric",
        ],
        properties: {
          questionType: { type: "string", enum: [spec.type] },
          competency: { type: "string", enum: [spec.competency] },
          difficulty: { type: "integer", enum: [spec.difficulty] },
          text: str(20, 700),
          purpose: str(10, 300),
          expectedEvidence: list(1, 6),
          followUpRules: list(1, 5),
          rubric: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["criterion", "weight"],
              properties: {
                criterion: str(1, 120),
                weight: { type: "integer", minimum: 1, maximum: 100 },
              },
            },
          },
        },
      },
    },
  };
}

// -----------------------------------------------------------------------------
// AI-assisted blueprint (response shape only — nothing is persisted)
// -----------------------------------------------------------------------------

export type QuestionGeneration = {
  attempts: number;
  failureType: AiFailureType | null;
  /** Model-written purpose statement; null unless AI_GENERATED. */
  purposeStatement: string | null;
};

export type AiAssistedQuestion = QuestionSpec & {
  generationMode: GenerationMode;
  generation: QuestionGeneration;
};

export type AiAssistedTraceabilityEntry = TraceabilityEntry & { generationMode: GenerationMode };

export type GenerationAuditOutcome = "RECORDED" | "NOT_NEEDED" | "NO_APPLICATION" | "WRITE_FAILED";

export type AiAssistedBlueprint = Omit<AssessmentBlueprint, "questions" | "traceability"> & {
  blueprintMode: "AI_ASSISTED";
  aiLayerVersion: typeof AI_LAYER_VERSION;
  questions: AiAssistedQuestion[];
  traceability: AiAssistedTraceabilityEntry[];
  generationSummary: {
    total: number;
    aiGenerated: number;
    fallback: number;
    model: string | null;
    audit: GenerationAuditOutcome;
  };
};

export function isAiAssistedBlueprint(
  b: AssessmentBlueprint | AiAssistedBlueprint,
): b is AiAssistedBlueprint {
  return (b as AiAssistedBlueprint).blueprintMode === "AI_ASSISTED";
}
