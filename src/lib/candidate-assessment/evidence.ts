import type { AssessmentInterviewBlock } from "./interview-block";

/**
 * V3.1 — links objective evidence to blueprint competencies without
 * interpreting it. Pure. No scores, no ratings, no recommendations: interview
 * items only say an answer was recorded; practical items copy the V3 result
 * values exactly as stored.
 */

export type EvidenceCompetency = {
  id: string;
  name: string;
  category: string;
  source: string;
  importance: string;
};

export type ResumeCompetencyInput = {
  competencyId: string;
  strength: "STRONG" | "WEAK" | "NONE";
  quotes: string[];
};

export type InterviewQuestionInput = {
  id: string;
  sequence: number;
  question: string;
  topic: string | null;
  competency: string | null;
  difficulty: string;
  action: string | null;
  answer: { answeredAt: Date; text: string } | null;
};

export type PracticalInput = {
  id: string;
  type: "CODING" | "SQL";
  title: string;
  taskKey: string;
  taskVersion: number;
  competency: string;
  status: string;
  required: boolean;
  submission: {
    id: string;
    language: string;
    execStatus: string;
    submittedAt: Date;
    executedAt: Date | null;
    result: unknown;
  } | null;
};

/** V3 result fields, copied verbatim (numbers stay numbers, missing stays null). */
export type PracticalResultView = {
  kind: "CODING" | "SQL" | "INFRASTRUCTURE" | null;
  status: string | null;
  passed: number | null;
  failed: number | null;
  total: number | null;
  runtimeMs: number | null;
  memoryMb: number | null;
  compileError: boolean | null;
  timedOut: boolean | null;
  resourceViolation: string | null;
  correct: boolean | null;
  rowCount: number | null;
  columnCount: number | null;
  rowLimitExceeded: boolean | null;
  mismatch: string | null;
  failureReason: string | null;
};

export type EvidenceItem =
  | {
      sourceType: "RESUME";
      sourceId: string;
      at: string | null;
      result: { strength: "STRONG" | "WEAK"; quotes: string[] };
    }
  | {
      sourceType: "INTERVIEW";
      sourceId: string;
      sessionId: string;
      at: string | null;
      result: {
        sequence: number;
        answered: boolean;
        fromBlueprint: boolean;
        assessmentQuestionId: string | null;
        generationMode: "AI_GENERATED" | "DETERMINISTIC_FALLBACK" | null;
      };
    }
  | {
      sourceType: "CODING" | "SQL";
      sourceId: string;
      submissionId: string | null;
      at: string | null;
      result: { assessmentStatus: string; submitted: boolean } & PracticalResultView;
    };

export type CompetencyEvidence = {
  competencyId: string | null;
  competency: string;
  inBlueprint: boolean;
  category: string | null;
  source: string | null;
  importance: string | null;
  items: EvidenceItem[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function practicalResultView(result: unknown): PracticalResultView {
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const kind = r.kind === "CODING" || r.kind === "SQL" || r.kind === "INFRASTRUCTURE" ? r.kind : null;
  return {
    kind,
    status: str(r.status),
    passed: num(r.passed),
    failed: num(r.failed),
    total: num(r.total),
    runtimeMs: num(r.runtimeMs),
    memoryMb: num(r.memoryMb),
    compileError: bool(r.compileError),
    timedOut: bool(r.timedOut),
    resourceViolation: str(r.resourceViolation),
    correct: bool(r.correct),
    rowCount: num(r.rowCount),
    columnCount: num(r.columnCount),
    rowLimitExceeded: bool(r.rowLimitExceeded),
    mismatch: str(r.mismatch),
    failureReason: kind === "INFRASTRUCTURE" ? str(r.reason) : null,
  };
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Which validated blueprint question (if any) an asked interview question is — matched on the exact validated text. */
export function matchBlueprintQuestion(
  block: AssessmentInterviewBlock | null,
  questionText: string,
): AssessmentInterviewBlock["questions"][number] | null {
  if (!block) return null;
  const n = normalizeText(questionText);
  return block.questions.find((q) => normalizeText(q.text) === n) ?? null;
}

export function buildEvidence(params: {
  competencies: EvidenceCompetency[];
  resume: { candidateId: string; at: Date | null; byCompetency: ResumeCompetencyInput[] };
  interview: { sessionId: string; block: AssessmentInterviewBlock | null; questions: InterviewQuestionInput[] } | null;
  practicals: PracticalInput[];
}): CompetencyEvidence[] {
  const entries: CompetencyEvidence[] = params.competencies.map((c) => ({
    competencyId: c.id,
    competency: c.name,
    inBlueprint: true,
    category: c.category,
    source: c.source,
    importance: c.importance,
    items: [],
  }));
  const byId = new Map(entries.map((e) => [e.competencyId!, e]));
  const byName = new Map(entries.map((e) => [normalizeText(e.competency), e]));

  const entryFor = (id: string | null, name: string): CompetencyEvidence => {
    const found = (id ? byId.get(id) : undefined) ?? byName.get(normalizeText(name));
    if (found) return found;
    const extra: CompetencyEvidence = {
      competencyId: id,
      competency: name,
      inBlueprint: false,
      category: null,
      source: null,
      importance: null,
      items: [],
    };
    entries.push(extra);
    byName.set(normalizeText(name), extra);
    if (id) byId.set(id, extra);
    return extra;
  };

  const resumeAt = params.resume.at?.toISOString() ?? null;
  for (const r of params.resume.byCompetency) {
    if (r.strength === "NONE" || r.quotes.length === 0) continue;
    const entry = byId.get(r.competencyId);
    if (!entry) continue;
    entry.items.push({
      sourceType: "RESUME",
      sourceId: `candidate:${params.resume.candidateId}:resume`,
      at: resumeAt,
      result: { strength: r.strength, quotes: r.quotes.slice(0, 3) },
    });
  }

  if (params.interview) {
    const { sessionId, block } = params.interview;
    for (const q of params.interview.questions) {
      const matched = matchBlueprintQuestion(block, q.question);
      const name = matched?.competency ?? q.competency ?? q.topic ?? "Unlabelled interview topic";
      entryFor(matched?.competencyId ?? null, name).items.push({
        sourceType: "INTERVIEW",
        sourceId: q.id,
        sessionId,
        at: q.answer?.answeredAt.toISOString() ?? null,
        result: {
          sequence: q.sequence,
          answered: Boolean(q.answer),
          fromBlueprint: Boolean(matched),
          assessmentQuestionId: matched?.id ?? null,
          generationMode: matched?.generationMode ?? null,
        },
      });
    }
  }

  for (const p of params.practicals) {
    const view = practicalResultView(p.submission?.result);
    entryFor(null, p.competency).items.push({
      sourceType: p.type,
      sourceId: p.id,
      submissionId: p.submission?.id ?? null,
      at: (p.submission?.executedAt ?? p.submission?.submittedAt)?.toISOString() ?? null,
      result: { assessmentStatus: p.status, submitted: Boolean(p.submission), ...view },
    });
  }

  return entries;
}
