import { buildCompetencyMatrix } from "./competency-matrix";
import { findForbiddenDecisionKeys, validateQuestionSpec } from "./guardrails";
import { analyzeJob, descriptionStatements } from "./jd-analyzer";
import { buildAssessmentPlan } from "./plan";
import { recommendPractical } from "./practical";
import { generateQuestions } from "./questions";
import { groundResume } from "./resume-grounding";
import { classifyRole } from "./role-classifier";
import {
  CompetencySchema,
  ENGINE_VERSION,
  type AssessmentBlueprint,
  type AssessmentPlan,
  type CandidateInput,
  type Competency,
  type JdAnalysis,
  type JobInput,
  type PracticalRecommendation,
  type QuestionSpec,
  type ResumeGrounding,
  type RoleClassification,
  type TraceabilityEntry,
  type ValidationIssue,
} from "./types";

export class AssessmentEngineError extends Error {
  constructor(
    public readonly code: "INVALID_INPUT" | "GUARDRAIL_VIOLATION",
    message: string,
  ) {
    super(message);
    this.name = "AssessmentEngineError";
  }
}

const BASE_LIMITATIONS = [
  "Deterministic keyword analysis: JD or resume phrasing outside the built-in vocabulary may be missed.",
  "The taxonomy covers 22 role families; niche or emerging roles may be classified UNKNOWN or HYBRID and need recruiter judgment.",
  "Practical exercises are recommendations only — V1 does not run, execute or grade them.",
  "Questions, rubrics and difficulty are advisory planning aids. They do not score candidates or make hiring decisions.",
];

function assertJob(job: JobInput): void {
  if (!job || typeof job.title !== "string" || typeof job.description !== "string" || !Array.isArray(job.skills)) {
    throw new AssessmentEngineError("INVALID_INPUT", "Job input is incomplete");
  }
}

/**
 * Orchestrates the V1 pipeline:
 * JD → role classification → competency matrix → resume grounding →
 * practical recommendation → adaptive plan → question specs → validation → traceability.
 *
 * Pure and deterministic; no database writes, no AI calls, no stage changes.
 */
export const AssessmentEngineService = {
  analyzeJob(job: JobInput): JdAnalysis {
    assertJob(job);
    return analyzeJob(job);
  },

  classifyRole(job: JobInput, analysis: JdAnalysis = AssessmentEngineService.analyzeJob(job)): RoleClassification {
    return classifyRole(analysis, descriptionStatements(job.description));
  },

  buildCompetencyMatrix(analysis: JdAnalysis, classification: RoleClassification): {
    competencies: Competency[];
    issues: ValidationIssue[];
  } {
    const issues: ValidationIssue[] = [];
    const competencies: Competency[] = [];
    for (const c of buildCompetencyMatrix(analysis, classification)) {
      const parsed = CompetencySchema.safeParse(c);
      if (parsed.success) competencies.push(parsed.data);
      else {
        issues.push({
          code: "MISSING_COMPETENCY_PROVENANCE",
          detail: `Competency "${c.name}" dropped: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        });
      }
    }
    return { competencies, issues };
  },

  groundResume(candidate: CandidateInput | null, competencies: Competency[]): ResumeGrounding {
    return groundResume(candidate, competencies);
  },

  buildPlan(params: {
    analysis: JdAnalysis;
    classification: RoleClassification;
    competencies: Competency[];
    resume: ResumeGrounding;
  }): { plan: AssessmentPlan; practical: PracticalRecommendation } {
    const practical = recommendPractical(params.classification, params.analysis.seniority, params.competencies);
    return { plan: buildAssessmentPlan({ ...params, practical }), practical };
  },

  buildBlueprint(input: {
    job: JobInput;
    candidate?: CandidateInput | null;
    now?: Date;
  }): AssessmentBlueprint {
    const { job } = input;
    const candidate = input.candidate ?? null;
    const analysis = AssessmentEngineService.analyzeJob(job);
    const classification = AssessmentEngineService.classifyRole(job, analysis);
    const { competencies, issues } = AssessmentEngineService.buildCompetencyMatrix(analysis, classification);
    const resume = AssessmentEngineService.groundResume(candidate, competencies);
    const { plan, practical } = AssessmentEngineService.buildPlan({ analysis, classification, competencies, resume });
    const generated = generateQuestions({ analysis, classification, competencies, plan, resume, practical });

    const validationIssues: ValidationIssue[] = [...issues];
    const questions: QuestionSpec[] = [];
    const ctx = {
      competencies,
      resumeText: candidate?.resumeText ?? null,
      profileSkills: candidate?.skills ?? [],
    };
    for (const q of generated) {
      const r = validateQuestionSpec(q, ctx);
      if (r.ok) questions.push(r.spec);
      else validationIssues.push(...r.issues);
    }

    // Keep stage counts honest if validation dropped anything.
    const stages = plan.stages
      .map((s) => ({ ...s, questionCount: questions.filter((q) => q.stageId === s.id).length }))
      .filter((s) => s.questionCount > 0);
    const finalPlan: AssessmentPlan = {
      ...plan,
      stages,
      totalQuestions: questions.length,
    };

    const byId = new Map(competencies.map((c) => [c.id, c]));
    const traceability: TraceabilityEntry[] = questions.map((q) => {
      const c = byId.get(q.competencyId)!;
      return {
        questionId: q.id,
        competencyId: c.id,
        competency: c.name,
        competencySource: c.source,
        jdEvidence: c.jdEvidence,
        resumeEvidence: q.sourceEvidence.resume,
        rubricCriteria: q.rubric.map((r) => ({ name: r.name, weight: r.weight })),
      };
    });

    const limitations = [...BASE_LIMITATIONS];
    if (classification.roleFamily === "UNKNOWN") {
      limitations.push("Role family could not be determined confidently; competencies fall back to general ones.");
    }
    if (analysis.missingInformation.length) {
      limitations.push("The job record is missing information (see JD analysis); the plan may be incomplete.");
    }

    const blueprint: AssessmentBlueprint = {
      engineVersion: ENGINE_VERSION,
      generatedAt: (input.now ?? new Date()).toISOString(),
      job: { id: job.id, title: analysis.title },
      candidate: candidate ? { applicationId: candidate.applicationId, name: candidate.name } : null,
      analysis,
      classification,
      competencies,
      plan: finalPlan,
      practical,
      questions,
      resume,
      traceability,
      guardrails: {
        advisoryOnly: true,
        noAutoDecision: true,
        noStageChange: true,
        proctoringExcluded: true,
        protectedAttributesExcluded: true,
        practicalExecution: false,
      },
      limitations,
      validationIssues,
    };

    const decisionKeys = findForbiddenDecisionKeys(blueprint);
    if (decisionKeys.length) {
      throw new AssessmentEngineError("GUARDRAIL_VIOLATION", "Blueprint contained decision fields");
    }
    return blueprint;
  },
};
