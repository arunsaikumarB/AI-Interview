import { z } from "zod";

/**
 * Assessment Engine V1 — domain model.
 *
 * Planning / question-generation layer only. Nothing here scores a candidate,
 * changes a pipeline stage, or makes a hiring decision. Blueprints are
 * computed on demand from Job + (optional) Candidate data; no schema change.
 */

export const ENGINE_VERSION = "assessment-engine-v1";

export const ROLE_FAMILIES = [
  "FRONTEND_ENGINEERING",
  "BACKEND_ENGINEERING",
  "FULLSTACK_ENGINEERING",
  "MOBILE_ENGINEERING",
  "DATA_ANALYTICS",
  "DATA_SCIENCE",
  "MACHINE_LEARNING",
  "DATA_ENGINEERING",
  "DEVOPS",
  "SRE",
  "CLOUD_ENGINEERING",
  "QA_TESTING",
  "CYBERSECURITY",
  "DATABASE_ENGINEERING",
  "UI_UX_DESIGN",
  "PRODUCT_MANAGEMENT",
  "BUSINESS_ANALYSIS",
  "PROJECT_PROGRAM_MANAGEMENT",
  "ENGINEERING_MANAGEMENT",
  "SOLUTIONS_ARCHITECTURE",
  "TECHNICAL_SUPPORT",
  "TECHNICAL_WRITING",
  "HYBRID",
  "UNKNOWN",
] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];
export type ConcreteRoleFamily = Exclude<RoleFamily, "HYBRID" | "UNKNOWN">;

export const SENIORITY_LEVELS = [
  "INTERN",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "PRINCIPAL",
  "UNKNOWN",
] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export const IMPORTANCE_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];

/** JD_REQUIRED / JD_PREFERRED come from the job itself; ROLE_STANDARD is the taxonomy default. */
export const COMPETENCY_SOURCES = ["JD_REQUIRED", "JD_PREFERRED", "ROLE_STANDARD"] as const;
export type CompetencySource = (typeof COMPETENCY_SOURCES)[number];

export const EXPECTED_LEVELS = ["FOUNDATIONAL", "WORKING", "ADVANCED", "EXPERT"] as const;
export type ExpectedLevel = (typeof EXPECTED_LEVELS)[number];

export const COMPETENCY_CATEGORIES = [
  "TECHNICAL",
  "PRACTICE",
  "DOMAIN",
  "BEHAVIORAL",
  "COMMUNICATION",
  "LEADERSHIP",
] as const;
export type CompetencyCategory = (typeof COMPETENCY_CATEGORIES)[number];

export const QUESTION_SOURCES = [
  "RESUME",
  "JD",
  "SKILL",
  "PREVIOUS_ANSWER",
  "ROLE",
  "SENIORITY",
] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const QUESTION_TYPES = [
  "RESUME_VERIFICATION",
  "FUNDAMENTAL",
  "ADVANCED",
  "SCENARIO",
  "TECHNICAL_REASONING",
  "PRACTICAL_RECOMMENDATION",
  "BEHAVIORAL",
  "COMMUNICATION",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_PURPOSES = [
  "VERIFY_CLAIM",
  "ASSESS_FOUNDATION",
  "ASSESS_DEPTH",
  "ASSESS_JUDGMENT",
  "ASSESS_COLLABORATION",
  "ASSESS_COMMUNICATION",
  "ASSESS_LEADERSHIP",
  "ASSESS_PRACTICAL",
  "PROBE_GAP",
] as const;
export type QuestionPurpose = (typeof QUESTION_PURPOSES)[number];

export const STAGE_TYPES = [
  "RESUME_VERIFICATION",
  "FOUNDATIONS",
  "ADVANCED",
  "PRACTICAL",
  "BEHAVIORAL",
  "LEADERSHIP",
] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export const PRACTICAL_TYPES = [
  "CODING_EXERCISE",
  "UI_COMPONENT_EXERCISE",
  "API_DESIGN_EXERCISE",
  "CODE_REVIEW",
  "SYSTEM_DESIGN",
  "SQL_ANALYSIS",
  "DATA_ANALYSIS_CASE",
  "ML_CASE_STUDY",
  "DATA_PIPELINE_DESIGN",
  "INFRASTRUCTURE_SCENARIO",
  "INCIDENT_RESPONSE",
  "TEST_PLAN",
  "SECURITY_SCENARIO",
  "DATA_MODEL_DESIGN",
  "DESIGN_CRITIQUE",
  "PRODUCT_CASE",
  "REQUIREMENTS_ANALYSIS",
  "PROJECT_PLAN_CASE",
  "LEADERSHIP_SCENARIO",
  "ARCHITECTURE_REVIEW",
  "TROUBLESHOOTING_SCENARIO",
  "WRITING_SAMPLE",
  "RECRUITER_DEFINED",
] as const;
export type PracticalType = (typeof PRACTICAL_TYPES)[number];

export const JD_FIELDS = [
  "title",
  "description",
  "skills",
  "mustHave",
  "niceToHave",
  "experienceRange",
] as const;
export type JdField = (typeof JD_FIELDS)[number];

// -----------------------------------------------------------------------------
// Evidence
// -----------------------------------------------------------------------------

export const JdEvidenceSchema = z
  .object({
    field: z.enum(JD_FIELDS),
    text: z.string().min(1).max(500),
  })
  .strict();
export type JdEvidence = z.infer<typeof JdEvidenceSchema>;

export const ResumeEvidenceSchema = z
  .object({
    field: z.enum(["resumeText", "profileSkills"]),
    quote: z.string().min(1).max(300),
    strength: z.enum(["STRONG", "WEAK"]),
  })
  .strict();
export type ResumeEvidence = z.infer<typeof ResumeEvidenceSchema>;

// -----------------------------------------------------------------------------
// JD analysis
// -----------------------------------------------------------------------------

export type JdSkill = {
  skill: string;
  required: boolean;
  importance: Importance;
  source: "JD";
  evidence: JdEvidence[];
};

export type JdAnalysis = {
  title: string;
  seniority: Seniority;
  seniorityEvidence: string | null;
  responsibilities: JdEvidence[];
  requiredSkills: JdSkill[];
  preferredSkills: JdSkill[];
  technologies: string[];
  domains: { name: string; evidence: string }[];
  yearsOfExperience: { min: number | null; max: number | null; evidence: string } | null;
  leadership: { expected: boolean; evidence: string[] };
  communication: { expected: boolean; evidence: string[] };
  /** JD statements ignored because they reference protected attributes. */
  excludedStatements: { text: string; reason: "PROTECTED_ATTRIBUTE"; attributes: string[] }[];
  missingInformation: string[];
};

// -----------------------------------------------------------------------------
// Role classification
// -----------------------------------------------------------------------------

export type RoleClassification = {
  roleFamily: RoleFamily;
  /** 0–1, never 1: keyword evidence cannot establish certainty. */
  confidence: number;
  evidence: string[];
  /** Families that contribute to a HYBRID role, or runner-ups worth noting. */
  secondaryFamilies: ConcreteRoleFamily[];
  scores: { family: ConcreteRoleFamily; score: number }[];
};

// -----------------------------------------------------------------------------
// Competency matrix
// -----------------------------------------------------------------------------

export const CompetencySchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    category: z.enum(COMPETENCY_CATEGORIES),
    source: z.enum(COMPETENCY_SOURCES),
    importance: z.enum(IMPORTANCE_LEVELS),
    expectedLevel: z.enum(EXPECTED_LEVELS),
    explanation: z.string().min(1).max(500),
    jdEvidence: z.array(JdEvidenceSchema).max(8),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.source !== "ROLE_STANDARD" && c.jdEvidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "JD-sourced competency requires JD evidence (provenance)",
        path: ["jdEvidence"],
      });
    }
  });
export type Competency = z.infer<typeof CompetencySchema>;

// -----------------------------------------------------------------------------
// Rubric + question spec
// -----------------------------------------------------------------------------

export const RubricCriterionSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(400),
    weight: z.number().int().min(1).max(100),
    evidence: z.array(z.string().min(1).max(300)).min(1).max(6),
  })
  .strict();
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const QuestionSpecSchema = z
  .object({
    id: z.string().min(1).max(120),
    stageId: z.string().min(1).max(60),
    text: z.string().min(10).max(800),
    type: z.enum(QUESTION_TYPES),
    competency: z.string().min(1).max(120),
    competencyId: z.string().min(1).max(80),
    difficulty: z.number().int().min(1).max(5),
    difficultyRationale: z.string().min(1).max(300),
    source: z.enum(QUESTION_SOURCES),
    sourceEvidence: z
      .object({
        jd: z.array(JdEvidenceSchema).max(8),
        resume: z.array(ResumeEvidenceSchema).max(4),
      })
      .strict(),
    purpose: z.enum(QUESTION_PURPOSES),
    expectedEvidence: z.array(z.string().min(1).max(300)).min(1).max(8),
    followUpRules: z.array(z.string().min(1).max(300)).min(1).max(6),
    rubric: z.array(RubricCriterionSchema).min(2).max(6),
    disallowedAssumptions: z.array(z.string().min(1).max(300)).min(1).max(10),
  })
  .strict();
export type QuestionSpec = z.infer<typeof QuestionSpecSchema>;

// -----------------------------------------------------------------------------
// Practical recommendation, plan, resume grounding
// -----------------------------------------------------------------------------

export type PracticalRecommendation = {
  type: PracticalType;
  title: string;
  competency: string;
  reason: string;
  expectedEvidence: string[];
  estimatedDifficulty: number;
  estimatedMinutes: number;
  /** V1 never runs or grades practical work. */
  executionSupported: false;
};

export type PlanStage = {
  id: string;
  type: StageType;
  title: string;
  purpose: string;
  questionCount: number;
  competencyIds: string[];
  estimatedMinutes: number;
  rationale: string;
};

export type AssessmentPlan = {
  stages: PlanStage[];
  totalQuestions: number;
  estimatedMinutes: number;
  rationale: string[];
};

export type CompetencyResumeEvidence = {
  competencyId: string;
  competency: string;
  strength: "STRONG" | "WEAK" | "NONE";
  evidence: ResumeEvidence[];
};

export type ResumeGrounding = {
  availability: "NO_CANDIDATE" | "NO_RESUME" | "ANALYZED";
  byCompetency: CompetencyResumeEvidence[];
  insufficient: {
    competencyId: string;
    competency: string;
    reason: "INSUFFICIENT_RESUME_EVIDENCE";
    detail: string;
  }[];
  /** Resume lines never quoted (protected attributes, contact details, instruction-like text). */
  excludedLineCount: number;
};

// -----------------------------------------------------------------------------
// Blueprint
// -----------------------------------------------------------------------------

export type ValidationIssueCode =
  | "MALFORMED"
  | "MISSING_COMPETENCY_PROVENANCE"
  | "INVENTED_RESUME_CLAIM"
  | "PROTECTED_ATTRIBUTE"
  | "INVALID_RUBRIC_WEIGHTS"
  | "AUTO_DECISION_ATTEMPT"
  | "UNSUPPORTED_CERTAINTY"
  // V2 — checks applied to model-written questions against the approved V1 spec.
  | "TYPE_MISMATCH"
  | "COMPETENCY_MISMATCH"
  | "DIFFICULTY_MISMATCH"
  | "CONTACT_DETAIL"
  | "PROMPT_INJECTION"
  | "UNSUPPORTED_TECHNOLOGY"
  | "MEANINGLESS_OUTPUT";

export type ValidationIssue = {
  code: ValidationIssueCode;
  detail: string;
  questionId?: string;
};

export type TraceabilityEntry = {
  questionId: string;
  competencyId: string;
  competency: string;
  competencySource: CompetencySource;
  jdEvidence: JdEvidence[];
  resumeEvidence: ResumeEvidence[];
  rubricCriteria: { name: string; weight: number }[];
};

export type JobInput = {
  id: string;
  title: string;
  description: string;
  skills: string[];
  experienceMin: number | null;
  experienceMax: number | null;
  screeningCriteria: unknown;
};

export type CandidateInput = {
  applicationId: string;
  name: string;
  resumeText: string | null;
  skills: string[];
};

export type AssessmentBlueprint = {
  engineVersion: typeof ENGINE_VERSION;
  generatedAt: string;
  job: { id: string; title: string };
  candidate: { applicationId: string; name: string } | null;
  analysis: JdAnalysis;
  classification: RoleClassification;
  competencies: Competency[];
  plan: AssessmentPlan;
  practical: PracticalRecommendation;
  questions: QuestionSpec[];
  resume: ResumeGrounding;
  traceability: TraceabilityEntry[];
  guardrails: {
    advisoryOnly: true;
    noAutoDecision: true;
    noStageChange: true;
    proctoringExcluded: true;
    protectedAttributesExcluded: true;
    practicalExecution: false;
  };
  limitations: string[];
  validationIssues: ValidationIssue[];
};
