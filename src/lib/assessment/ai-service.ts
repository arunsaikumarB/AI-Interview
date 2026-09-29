import {
  defaultGenerationOptions,
  generateQuestionWithAi,
  ollamaChat,
  type AiChatFn,
  type GenerationOptions,
} from "./ai-generator";
import {
  AI_LAYER_VERSION,
  type AiAssistedBlueprint,
  type AiAssistedQuestion,
  type AiFailureType,
  type GenerationAuditOutcome,
} from "./ai-schema";
import { findForbiddenDecisionKeys } from "./guardrails";
import { AssessmentEngineError } from "./service";
import type { AssessmentBlueprint, CandidateInput } from "./types";

export type GenerationFailure = { questionId: string; failureType: AiFailureType; attempts: number };

export const GENERATION_FAILURE_TIMELINE_KIND = "assessment_question_generation_failed" as const;

/**
 * TimelineEvent row for questions that fell back to deterministic wording.
 * Identifiers, failure types and counts only — no prompt, model output,
 * resume text or candidate PII. Never an AIEvaluation.
 */
export type GenerationFailureAuditRecord = {
  applicationId: string;
  type: "OTHER";
  payload: {
    kind: typeof GENERATION_FAILURE_TIMELINE_KIND;
    advisoryOnly: true;
    engineVersion: typeof AI_LAYER_VERSION;
    jobId: string;
    actorId: string;
    generationMode: "DETERMINISTIC_FALLBACK";
    totalQuestions: number;
    fallbackCount: number;
    failures: GenerationFailure[];
    at: string;
  };
};

export type GenerationAuditSink = (record: GenerationFailureAuditRecord) => Promise<void>;

/** Minimal DB surface: the audit can only ever write a TimelineEvent. */
export type TimelineWriter = {
  timelineEvent: {
    create(args: {
      data: { applicationId: string; type: "OTHER"; payload: Record<string, unknown> };
    }): Promise<unknown>;
  };
};

export function timelineAuditSink(db: TimelineWriter): GenerationAuditSink {
  return async (record) => {
    await db.timelineEvent.create({
      data: { applicationId: record.applicationId, type: record.type, payload: { ...record.payload } },
    });
  };
}

export function buildGenerationFailureAudit(params: {
  applicationId: string;
  jobId: string;
  actorId: string;
  totalQuestions: number;
  failures: GenerationFailure[];
  now: Date;
}): GenerationFailureAuditRecord {
  return {
    applicationId: params.applicationId,
    type: "OTHER",
    payload: {
      kind: GENERATION_FAILURE_TIMELINE_KIND,
      advisoryOnly: true,
      engineVersion: AI_LAYER_VERSION,
      jobId: params.jobId,
      actorId: params.actorId,
      generationMode: "DETERMINISTIC_FALLBACK",
      totalQuestions: params.totalQuestions,
      fallbackCount: params.failures.length,
      failures: params.failures.slice(0, 20).map((f) => ({
        questionId: f.questionId,
        failureType: f.failureType,
        attempts: f.attempts,
      })),
      at: params.now.toISOString(),
    },
  };
}

/**
 * V1 blueprint → one bounded model call per approved question → validation →
 * AI wording or deterministic fallback. The V1 blueprint is never mutated;
 * structure (competencies, plan, stages, types, difficulty, evidence) is
 * copied through unchanged. Writes nothing except the optional failure audit.
 */
export async function generateAiAssistedBlueprint(params: {
  blueprint: AssessmentBlueprint;
  candidate: CandidateInput | null;
  actorId: string;
  chat?: AiChatFn;
  audit?: GenerationAuditSink;
  options?: Partial<GenerationOptions>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<AiAssistedBlueprint> {
  const base = structuredClone(params.blueprint);
  const chat = params.chat ?? ollamaChat;
  const options: GenerationOptions = { ...defaultGenerationOptions(), ...params.options };
  const clock = params.now ?? Date.now;
  const deadline = clock() + options.totalBudgetMs;
  const specContext = {
    competencies: base.competencies,
    resumeText: params.candidate?.resumeText ?? null,
    profileSkills: params.candidate?.skills ?? [],
  };

  const questions: AiAssistedQuestion[] = [];
  const failures: GenerationFailure[] = [];
  let model: string | null = null;
  let unavailable: AiFailureType | null = null;

  for (const spec of base.questions) {
    if (unavailable) {
      failures.push({ questionId: spec.id, failureType: unavailable, attempts: 0 });
      questions.push({
        ...spec,
        generationMode: "DETERMINISTIC_FALLBACK",
        generation: { attempts: 0, failureType: unavailable, purposeStatement: null },
      });
      continue;
    }
    const r = await generateQuestionWithAi({
      blueprint: base,
      spec,
      candidateName: params.candidate?.name ?? null,
      specContext,
      chat,
      options,
      deadline,
      now: clock,
      sleep: params.sleep,
    });
    if (r.ok) {
      model = r.model;
      questions.push({
        ...r.spec,
        generationMode: "AI_GENERATED",
        generation: { attempts: r.attempts, failureType: null, purposeStatement: r.purposeStatement },
      });
    } else {
      if (r.modelUnavailable) unavailable = r.failureType;
      failures.push({ questionId: spec.id, failureType: r.failureType, attempts: r.attempts });
      questions.push({
        ...spec,
        generationMode: "DETERMINISTIC_FALLBACK",
        generation: { attempts: r.attempts, failureType: r.failureType, purposeStatement: null },
      });
    }
  }

  const modeById = new Map(questions.map((q) => [q.id, q.generationMode]));
  const weightsById = new Map(questions.map((q) => [q.id, q.rubric.map((c) => ({ name: c.name, weight: c.weight }))]));
  const traceability = base.traceability.map((t) => ({
    ...t,
    rubricCriteria: weightsById.get(t.questionId) ?? t.rubricCriteria,
    generationMode: modeById.get(t.questionId) ?? "DETERMINISTIC_FALLBACK",
  }));

  let audit: GenerationAuditOutcome = "NOT_NEEDED";
  if (failures.length) {
    if (!params.candidate) {
      audit = "NO_APPLICATION";
    } else if (params.audit) {
      try {
        await params.audit(
          buildGenerationFailureAudit({
            applicationId: params.candidate.applicationId,
            jobId: base.job.id,
            actorId: params.actorId,
            totalQuestions: questions.length,
            failures,
            now: new Date(clock()),
          }),
        );
        audit = "RECORDED";
      } catch {
        audit = "WRITE_FAILED";
      }
    } else {
      audit = "WRITE_FAILED";
    }
  }

  const aiGenerated = questions.filter((q) => q.generationMode === "AI_GENERATED").length;
  const result: AiAssistedBlueprint = {
    ...base,
    generatedAt: new Date(clock()).toISOString(),
    blueprintMode: "AI_ASSISTED",
    aiLayerVersion: AI_LAYER_VERSION,
    questions,
    traceability,
    limitations: [
      ...base.limitations,
      "AI wording is generated by the configured local model inside V1 boundaries and validated before use; wording may vary between runs.",
      "Questions marked Deterministic Fallback use the V1 wording because the model output failed or was unavailable.",
    ],
    generationSummary: {
      total: questions.length,
      aiGenerated,
      fallback: questions.length - aiGenerated,
      model,
      audit,
    },
  };

  if (findForbiddenDecisionKeys(result).length) {
    throw new AssessmentEngineError("GUARDRAIL_VIOLATION", "AI-assisted blueprint contained decision fields");
  }
  return result;
}
