import { z } from "zod";
import { EVALUATION_RETRY_DELAY_MS, MAX_EVALUATION_ATTEMPTS } from "@/lib/ai/evaluation-status";
import { chatJSON } from "@/lib/ai/ollama";
import {
  AiQuestionOutputSchema,
  aiQuestionJsonSchema,
  type AiFailureType,
} from "./ai-schema";
import {
  buildQuestionPromptInput,
  QUESTION_SYSTEM_PROMPT,
  renderQuestionUserPrompt,
} from "./ai-prompts";
import {
  cleanText,
  findForbiddenDecisionKeys,
  findProtectedAttributes,
  findUnsupportedTechnologies,
  hasDecisionLanguage,
  hasUnsupportedCertainty,
  isMeaninglessItem,
  isMeaninglessQuestion,
  looksLikeContactDetail,
  looksLikePromptInjection,
  normalizeForMatch,
  validateQuestionSpec,
  type SpecValidationContext,
} from "./guardrails";
import { validateRubric } from "./rubric";
import { lookupSkill, matchersFor, TECHNICAL_SKILL_CATEGORIES } from "./skills";
import type { AssessmentBlueprint, QuestionSpec, ValidationIssue, ValidationIssueCode } from "./types";

/** Same bound as R-3 evaluation retries. */
export const MAX_GENERATION_ATTEMPTS = MAX_EVALUATION_ATTEMPTS;

export type AiChatFn = (
  system: string,
  user: string,
  options: { jsonSchema: Record<string, unknown>; timeoutMs: number; numPredict: number; temperature: number },
) => Promise<{ data: unknown; model: string }>;

export type GenerationOptions = {
  /** Upper bound for a single model call. */
  perAttemptTimeoutMs: number;
  /** Wall-clock budget for the whole blueprint; remaining questions fall back once spent. */
  totalBudgetMs: number;
  numPredict: number;
  temperature: number;
  retryDelayMs: number;
};

export function defaultGenerationOptions(): GenerationOptions {
  return {
    // Same per-call timeout as every other chatJSON caller.
    perAttemptTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 240_000),
    // One synchronous request: stay under the common 300 s client/proxy header timeout.
    totalBudgetMs: 240_000,
    numPredict: 600,
    temperature: 0.2,
    retryDelayMs: EVALUATION_RETRY_DELAY_MS,
  };
}

export const DEFAULT_GENERATION_OPTIONS: GenerationOptions = defaultGenerationOptions();

// -----------------------------------------------------------------------------
// Model error classification
// -----------------------------------------------------------------------------

export type ClassifiedFailure = { type: AiFailureType; retryable: boolean };

/**
 * Maps chatJSON / transport errors onto the V2 failure types. A timeout is not
 * retried: a local model that needed the full per-call timeout will need it
 * again, and repeating it would spend the whole budget on one question.
 */
export function classifyModelError(err: unknown): ClassifiedFailure {
  const e = err as { name?: unknown; code?: unknown; message?: unknown; causeDetail?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name : "";
  const message = typeof e?.message === "string" ? e.message : "";
  if (name === "AIError") {
    switch (e?.code) {
      case "OLLAMA_UNREACHABLE":
        return /timed out/i.test(message)
          ? { type: "TIMEOUT", retryable: false }
          : { type: "MODEL_FAILURE", retryable: true };
      case "OLLAMA_HTTP": {
        const status = (e?.causeDetail as { status?: unknown } | undefined)?.status;
        const transient = typeof status === "number" && (status >= 500 || status === 429);
        return { type: "MODEL_FAILURE", retryable: transient };
      }
      case "INVALID_JSON":
        return { type: "INVALID_JSON", retryable: true };
      default:
        // VALIDATION here means configuration (e.g. missing cloud key): the
        // output schema passed to chatJSON accepts any JSON value.
        return { type: "MODEL_FAILURE", retryable: false };
    }
  }
  if (name === "AbortError" || name === "TimeoutError") return { type: "TIMEOUT", retryable: false };
  return { type: "MODEL_FAILURE", retryable: false };
}

// -----------------------------------------------------------------------------
// Output validation
// -----------------------------------------------------------------------------

export type AiValidationContext = {
  spec: QuestionSpec;
  allowed: { skills: string[]; text: string };
  resumeEvidence: string[];
  specContext: SpecValidationContext;
};

export type AiValidationResult =
  | { ok: true; spec: QuestionSpec; purposeStatement: string }
  | { ok: false; failureType: "SCHEMA_VALIDATION_FAILURE" | "GUARDRAIL_FAILURE"; issues: ValidationIssue[] };

/** Scope markers that exceed an introductory (difficulty ≤ 2) question. */
const ADVANCED_SCOPE =
  /\b(?:globally distributed|planet[- ]scale|multi-region active[- ]active|company-wide strategy|org-wide strategy|principal-level|staff-level|billions of (?:users|requests))\b/i;

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have in into is it its of on or our that the their this to was were with you your".split(
    " ",
  ),
);

function significantTokens(s: string): string[] {
  return (normalizeForMatch(s).match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []).filter(
    (t) => t.length >= 4 && !STOPWORDS.has(t),
  );
}

function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

/** The resume question must visibly reference the approved evidence. */
function referencesEvidence(text: string, evidence: string[]): boolean {
  const textTokens = new Set(significantTokens(text));
  return evidence.some((ev) => {
    const tokens = significantTokens(ev);
    if (tokens.length === 0) return false;
    const hits = tokens.filter((t) => textTokens.has(t)).length;
    return hits / tokens.length >= 0.3 || (tokens.length <= 2 && hits >= 1);
  });
}

function issue(code: ValidationIssueCode, detail: string, questionId: string): ValidationIssue {
  return { code, detail, questionId };
}

/**
 * raw → decision-field scan → schema → slot match → rubric → content guardrails
 * → V1 validateQuestionSpec on the merged spec. Only a spec that passes all of
 * it can replace the deterministic wording.
 */
export function validateAiQuestionOutput(raw: unknown, ctx: AiValidationContext): AiValidationResult {
  const { spec } = ctx;
  const qid = spec.id;

  const decisionKeys = findForbiddenDecisionKeys(raw);
  if (decisionKeys.length) {
    return {
      ok: false,
      failureType: "GUARDRAIL_FAILURE",
      issues: [issue("AUTO_DECISION_ATTEMPT", `Decision/stage fields are not allowed: ${decisionKeys.join(", ")}`, qid)],
    };
  }

  const parsed = AiQuestionOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      failureType: "SCHEMA_VALIDATION_FAILURE",
      issues: [
        issue(
          "MALFORMED",
          parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
          qid,
        ),
      ],
    };
  }
  const q = parsed.data.question;
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssueCode, detail: string) => issues.push(issue(code, detail, qid));

  if (q.questionType !== spec.type) add("TYPE_MISMATCH", `Expected ${spec.type}, got ${q.questionType}`);
  if (normalizeForMatch(q.competency) !== normalizeForMatch(spec.competency)) {
    add("COMPETENCY_MISMATCH", "Output names a different competency than the approved slot");
  }
  if (q.difficulty !== spec.difficulty) add("DIFFICULTY_MISMATCH", `Expected difficulty ${spec.difficulty}, got ${q.difficulty}`);

  // Rubric: V1 criteria only, weights total 100, each within ±15 of the V1 weight.
  const v1ByName = new Map(spec.rubric.map((r) => [normalizeForMatch(r.name), r]));
  const outNames = q.rubric.map((r) => normalizeForMatch(r.criterion));
  const rubricCheck = validateRubric(q.rubric.map((r) => ({ name: r.criterion, weight: r.weight })));
  if (!rubricCheck.ok) add("INVALID_RUBRIC_WEIGHTS", rubricCheck.issues.join("; "));
  if (
    new Set(outNames).size !== outNames.length ||
    outNames.length !== v1ByName.size ||
    outNames.some((n) => !v1ByName.has(n))
  ) {
    add("INVALID_RUBRIC_WEIGHTS", "Rubric criteria must match the approved criteria exactly");
  } else if (
    q.rubric.some((r) => {
      const base = v1ByName.get(normalizeForMatch(r.criterion))!.weight;
      return r.weight < 5 || Math.abs(r.weight - base) > 15;
    })
  ) {
    add("INVALID_RUBRIC_WEIGHTS", "Rubric weights drift too far from the approved weights");
  }

  const text = cleanText(q.text);
  const purpose = cleanText(q.purpose);
  const expectedEvidence = q.expectedEvidence.map(cleanText);
  const followUpRules = q.followUpRules.map(cleanText);
  const allTexts = [text, purpose, ...expectedEvidence, ...followUpRules, ...q.rubric.map((r) => r.criterion)];

  if (allTexts.some(looksLikePromptInjection)) add("PROMPT_INJECTION", "Output contains instruction-like or prompt-leaking text");
  if (allTexts.some(hasDecisionLanguage)) add("AUTO_DECISION_ATTEMPT", "Output contains hiring-decision or stage language");
  const attrs = new Set(allTexts.flatMap(findProtectedAttributes));
  if (attrs.size) add("PROTECTED_ATTRIBUTE", `References protected attribute(s): ${Array.from(attrs).join(", ")}`);
  if (allTexts.some(looksLikeContactDetail)) add("CONTACT_DETAIL", "Output contains contact-like details");
  if (allTexts.some(hasUnsupportedCertainty)) add("UNSUPPORTED_CERTAINTY", "Uses certainty language that evidence cannot support");
  if (isMeaninglessQuestion(text) || [purpose, ...expectedEvidence, ...followUpRules].some(isMeaninglessItem)) {
    add("MEANINGLESS_OUTPUT", "Question or supporting items are empty, placeholder or not a question");
  }

  const unsupported = findUnsupportedTechnologies([text, ...expectedEvidence, ...followUpRules], ctx.allowed);
  if (unsupported.length) add("UNSUPPORTED_TECHNOLOGY", `Introduces unsupported technology: ${unsupported.join(", ")}`);

  const skill = lookupSkill(spec.competency);
  if (skill && TECHNICAL_SKILL_CATEGORIES.has(skill.category)) {
    const res = matchersFor(spec.competency);
    if (![text, purpose, ...expectedEvidence].some((t) => res.some((re) => re.test(t)))) {
      add("COMPETENCY_MISMATCH", "Question does not address the approved competency");
    }
  }
  if (spec.difficulty <= 2 && ADVANCED_SCOPE.test(text)) {
    add("DIFFICULTY_MISMATCH", "Question scope exceeds the approved difficulty");
  }

  if (spec.source === "RESUME") {
    if (!referencesEvidence(text, ctx.resumeEvidence)) {
      add("INVENTED_RESUME_CLAIM", "Resume question does not reference the approved resume evidence");
    }
    const evidenceNumbers = new Set(ctx.resumeEvidence.flatMap(numbersIn));
    if (numbersIn(text).some((n) => !evidenceNumbers.has(n))) {
      add("INVENTED_RESUME_CLAIM", "Resume question introduces figures that are not in the evidence");
    }
  }

  if (issues.length) return { ok: false, failureType: "GUARDRAIL_FAILURE", issues };

  const merged: QuestionSpec = {
    ...spec,
    text,
    expectedEvidence,
    followUpRules,
    rubric: spec.rubric.map((r) => ({
      ...r,
      weight: q.rubric.find((o) => normalizeForMatch(o.criterion) === normalizeForMatch(r.name))!.weight,
    })),
  };
  const v1 = validateQuestionSpec(merged, ctx.specContext);
  if (!v1.ok) {
    return {
      ok: false,
      failureType: v1.issues.some((i) => i.code === "MALFORMED") ? "SCHEMA_VALIDATION_FAILURE" : "GUARDRAIL_FAILURE",
      issues: v1.issues,
    };
  }
  return { ok: true, spec: v1.spec, purposeStatement: purpose };
}

// -----------------------------------------------------------------------------
// One question, bounded attempts
// -----------------------------------------------------------------------------

export type QuestionGenerationResult =
  | { ok: true; spec: QuestionSpec; purposeStatement: string; attempts: number; model: string }
  | {
      ok: false;
      failureType: AiFailureType;
      attempts: number;
      /** The model itself is unusable (down, timing out, misconfigured): skip it for the remaining questions. */
      modelUnavailable: boolean;
    };

const passthrough = z.unknown();

export async function generateQuestionWithAi(params: {
  blueprint: AssessmentBlueprint;
  spec: QuestionSpec;
  candidateName: string | null;
  specContext: SpecValidationContext;
  chat: AiChatFn;
  options: GenerationOptions;
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<QuestionGenerationResult> {
  const now = params.now ?? Date.now;
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { spec, options } = params;

  const prompt = buildQuestionPromptInput({ blueprint: params.blueprint, spec, candidateName: params.candidateName });
  if (!prompt.ok) return { ok: false, failureType: "GUARDRAIL_FAILURE", attempts: 0, modelUnavailable: false };

  const jsonSchema = aiQuestionJsonSchema(spec);
  let rejectedCodes: string[] = [];
  let last: ClassifiedFailure = { type: "MODEL_FAILURE", retryable: false };
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const remaining = params.deadline - now();
    if (remaining <= 1_000) {
      return { ok: false, failureType: "TIMEOUT", attempts, modelUnavailable: true };
    }
    attempts = attempt;
    let data: unknown;
    let model: string;
    try {
      const res = await params.chat(QUESTION_SYSTEM_PROMPT, renderQuestionUserPrompt(prompt.input, rejectedCodes), {
        jsonSchema,
        timeoutMs: Math.min(options.perAttemptTimeoutMs, remaining),
        numPredict: options.numPredict,
        temperature: options.temperature,
      });
      data = res.data;
      model = res.model;
    } catch (err) {
      last = classifyModelError(err);
      if (!last.retryable) return { ok: false, failureType: last.type, attempts, modelUnavailable: true };
      if (last.type === "INVALID_JSON") rejectedCodes = ["INVALID_JSON"];
      if (last.type === "MODEL_FAILURE" && attempt < MAX_GENERATION_ATTEMPTS) await sleep(options.retryDelayMs);
      continue;
    }

    const v = validateAiQuestionOutput(data, {
      spec,
      allowed: prompt.allowed,
      resumeEvidence: prompt.resumeEvidence,
      specContext: params.specContext,
    });
    if (v.ok) return { ok: true, spec: v.spec, purposeStatement: v.purposeStatement, attempts, model };
    last = { type: v.failureType, retryable: true };
    // Codes only, plus vocabulary skill names for unsupported technology —
    // never echo model output or evidence back into the prompt.
    const unsupported = v.issues
      .filter((i) => i.code === "UNSUPPORTED_TECHNOLOGY")
      .flatMap((i) => i.detail.replace(/^[^:]*:\s*/, "").split(/,\s*/))
      .filter((n) => /^[A-Za-z0-9 .+#/-]{1,40}$/.test(n));
    rejectedCodes = Array.from(new Set(v.issues.map((i) => i.code)));
    if (unsupported.length) rejectedCodes.push(`remove: ${Array.from(new Set(unsupported)).join(", ")}`);
  }

  return {
    ok: false,
    failureType: last.type,
    attempts,
    modelUnavailable: last.type === "MODEL_FAILURE" || last.type === "TIMEOUT",
  };
}

/** Production chat function: existing chatJSON, internal retry disabled so V2 owns the attempt count. */
export const ollamaChat: AiChatFn = async (system, user, options) => {
  const res = await chatJSON(system, user, passthrough, { ...options, maxAttempts: 1 });
  return { data: res.data, model: res.model };
};
