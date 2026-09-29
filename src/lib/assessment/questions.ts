import { difficultyFor } from "./difficulty";
import { STANDARD_DISALLOWED_ASSUMPTIONS } from "./guardrails";
import { rubricFor } from "./rubric";
import { lookupSkill, type SkillCategory } from "./skills";
import { ROLE_TAXONOMY } from "./taxonomy";
import type {
  AssessmentPlan,
  Competency,
  JdAnalysis,
  PlanStage,
  PracticalRecommendation,
  PracticalType,
  QuestionPurpose,
  QuestionSource,
  QuestionSpec,
  QuestionType,
  ResumeEvidence,
  ResumeGrounding,
  RoleClassification,
} from "./types";

type Theme =
  | "FRONTEND"
  | "BACKEND"
  | "DATABASE"
  | "INFRA"
  | "DATA"
  | "ML"
  | "TESTING"
  | "SECURITY"
  | "DESIGN"
  | "BUSINESS"
  | "GENERAL";

function themeOf(c: Competency): Theme {
  const cat: SkillCategory | undefined = lookupSkill(c.name)?.category;
  switch (cat) {
    case "FRONTEND":
    case "MOBILE":
      return "FRONTEND";
    case "BACKEND":
    case "LANGUAGE":
    case "ARCHITECTURE":
      return "BACKEND";
    case "DATABASE":
      return "DATABASE";
    case "CLOUD":
    case "DEVOPS":
      return "INFRA";
    case "DATA":
    case "DATA_ENG":
      return "DATA";
    case "ML":
      return "ML";
    case "TESTING":
      return "TESTING";
    case "SECURITY":
      return "SECURITY";
    case "DESIGN":
      return "DESIGN";
    case "PRODUCT":
    case "PROJECT":
    case "ANALYSIS":
    case "SUPPORT":
    case "WRITING":
      return "BUSINESS";
  }
  if (/\b(ui|component|frontend|mobile)\b/i.test(c.name)) return "FRONTEND";
  if (/\b(api|service|integration|architecture|system)\b/i.test(c.name)) return "BACKEND";
  if (/\b(data model|database|backup|replication)\b/i.test(c.name)) return "DATABASE";
  if (/\b(ci\/cd|infrastructure|cloud|observability|incident|slo|capacity)\b/i.test(c.name)) return "INFRA";
  if (/\b(model|ml)\b/i.test(c.name)) return "ML";
  if (/\b(sql|data|statistic|visuali)/i.test(c.name)) return "DATA";
  if (/\b(test|defect)\b/i.test(c.name)) return "TESTING";
  if (/\b(threat|vulnerab|security)\b/i.test(c.name)) return "SECURITY";
  if (/\b(design|research|interaction|visual)\b/i.test(c.name)) return "DESIGN";
  if (c.category === "PRACTICE") return "BUSINESS";
  return "GENERAL";
}

const FUNDAMENTAL: Record<Theme, (x: string) => string> = {
  FRONTEND: (x) => `How does ${x} handle rendering and state changes? Explain with an example of a component or screen you would build.`,
  BACKEND: (x) => `Explain the key concepts of ${x} for building reliable server-side functionality — for example request handling, error handling and data access.`,
  DATABASE: (x) => `Explain how you would model and query data with ${x} for a typical feature in this role. Which modelling or indexing decisions matter most, and why?`,
  INFRA: (x) => `Explain the core building blocks of ${x} and how you would use them to deploy and operate a service safely.`,
  DATA: (x) => `Walk through how you would use ${x} to answer a business question, from raw data to a result you would trust.`,
  ML: (x) => `Explain the fundamentals of ${x} and how you would check that a model built with it actually works.`,
  TESTING: (x) => `Explain where ${x} fits in a test strategy. What would you cover with it, and what would you deliberately not?`,
  SECURITY: (x) => `Explain the core principles behind ${x} and a common mistake teams make with it.`,
  DESIGN: (x) => `Explain how you apply ${x} in a design process, with an example of a decision it informed.`,
  BUSINESS: (x) => `Explain how you apply ${x} in practice. What does a good outcome look like, and what are the common pitfalls?`,
  GENERAL: (x) => `Explain the fundamentals of ${x} as they apply to this role, with a short example.`,
};

const ADVANCED: Record<Theme, (x: string) => string> = {
  FRONTEND: (x) => `A ${x} screen becomes slow and janky as data grows. How would you find the cause, and what trade-offs would you weigh between possible fixes?`,
  BACKEND: (x) => `A service that relies on ${x} starts timing out under peak load. How would you investigate, and which fixes would you prioritise and why?`,
  DATABASE: (x) => `A critical ${x} query has become slow in production. How do you diagnose it, and what are the trade-offs of each fix you might apply?`,
  INFRA: (x) => `A deployment involving ${x} fails intermittently in production. How would you isolate the cause and prevent it recurring?`,
  DATA: (x) => `Your ${x} work produces a result stakeholders find surprising. How do you verify it before presenting it, and how do you communicate uncertainty?`,
  ML: (x) => `A model involving ${x} performs well offline but poorly in production. What could cause this, and how would you investigate?`,
  TESTING: (x) => `Your ${x} suite is slow and flaky, and the team has stopped trusting it. How would you diagnose and fix that?`,
  SECURITY: (x) => `You find a serious weakness related to ${x} days before a major release. How do you assess severity and decide what happens next?`,
  DESIGN: (x) => `User research contradicts a senior stakeholder's preferred direction for ${x}. How do you resolve it?`,
  BUSINESS: (x) => `Two important stakeholders want conflicting outcomes that both depend on ${x}. How do you decide, and how do you communicate the decision?`,
  GENERAL: (x) => `Describe a hard problem involving ${x}. How would you diagnose it, and what trade-offs would you weigh between possible solutions?`,
};

const SCENARIO = (x: string, roleLabel: string) =>
  `Scenario: as a ${roleLabel} you are asked to deliver work that depends heavily on ${x}. Requirements are ambiguous and the deadline is tight. What do you clarify first, how do you plan the work, and which risks do you raise?`;

const REASONING = (x: string) =>
  `Pick a situation where there are two reasonable ways to use ${x}. How would you decide between them? Explain the factors that drive your choice.`;

const PROBE_GAP = (x: string) =>
  `This role requires ${x}. Describe any hands-on experience you have with ${x}. If you have not used it, explain how you would get productive with it for this role.`;

const PRACTICAL_BRIEF: Record<PracticalType, (x: string) => string> = {
  CODING_EXERCISE: (x) => `Implement a small, well-scoped feature using ${x}, then explain design choices and trade-offs.`,
  UI_COMPONENT_EXERCISE: (x) => `Build or extend an accessible UI component using ${x}, including loading and error states.`,
  API_DESIGN_EXERCISE: (x) => `Design and implement a small API endpoint (${x}) with validation, error handling and a test.`,
  CODE_REVIEW: (x) => `Review a short code sample involving ${x} and explain the issues you would raise and why.`,
  SYSTEM_DESIGN: (x) => `Design a system for a stated use case, focusing on ${x}, and defend key trade-offs.`,
  SQL_ANALYSIS: (x) => `Given a sample dataset, write queries (${x}) that answer a business question and explain what the result does and does not show.`,
  DATA_ANALYSIS_CASE: (x) => `Analyse a provided dataset using ${x} and present a caveated conclusion.`,
  ML_CASE_STUDY: (x) => `Frame an ML problem, choose an approach and validation strategy (${x}), and discuss limitations.`,
  DATA_PIPELINE_DESIGN: (x) => `Design a pipeline (${x}) that handles late, duplicate and malformed data, with a backfill plan.`,
  INFRASTRUCTURE_SCENARIO: (x) => `Design a safe deployment path for a service (${x}), including rollback and monitoring.`,
  INCIDENT_RESPONSE: (x) => `Walk through a simulated production incident (${x}): triage, mitigation, communication and follow-ups.`,
  TEST_PLAN: (x) => `Write a risk-based test plan for a described feature (${x}) and choose what to automate.`,
  SECURITY_SCENARIO: (x) => `Analyse a described system or incident (${x}) and prioritise mitigations.`,
  DATA_MODEL_DESIGN: (x) => `Design a schema for a described domain and tune a slow query (${x}), explaining index choices.`,
  DESIGN_CRITIQUE: (x) => `Critique a provided user flow (${x}) and propose improvements grounded in user needs.`,
  PRODUCT_CASE: (x) => `Work through a product case (${x}): frame the problem, prioritise options, define success metrics.`,
  REQUIREMENTS_ANALYSIS: (x) => `Turn an ambiguous brief into user stories with acceptance criteria (${x}).`,
  PROJECT_PLAN_CASE: (x) => `Plan or recover a described project (${x}) with risks, owners and stakeholder communication.`,
  LEADERSHIP_SCENARIO: (x) => `Respond to a people-and-delivery scenario (${x}) and explain your plan and communication.`,
  ARCHITECTURE_REVIEW: (x) => `Produce and defend an architecture (${x}) against stated functional and non-functional requirements.`,
  TROUBLESHOOTING_SCENARIO: (x) => `Diagnose a realistic support ticket (${x}) step by step and draft the customer update.`,
  WRITING_SAMPLE: (x) => `Rewrite or produce a short document (${x}) for a stated audience.`,
  RECRUITER_DEFINED: () => `The recruiter should define a work sample that reflects the real job; the engine could not recommend a format with confidence.`,
};

const EXPECTED: Record<QuestionType, (x: string) => string[]> = {
  RESUME_VERIFICATION: (x) => [
    "Specific personal contribution, not only team outcomes",
    `Technical details about ${x} consistent with the resume claim`,
    "A measurable outcome or an honest statement of impact",
  ],
  FUNDAMENTAL: (x) => [`Accurate explanation of core ${x} concepts`, "A concrete, correct example", "Awareness of common pitfalls"],
  ADVANCED: () => ["Systematic diagnosis steps", "At least two options with trade-offs", "Consideration of failure modes and verification"],
  SCENARIO: () => ["Clarifying questions and stated assumptions", "A feasible, ordered plan", "Risks raised with mitigations"],
  TECHNICAL_REASONING: () => ["Clear decision criteria", "Correct technical reasoning", "Context-appropriate conclusion"],
  PRACTICAL_RECOMMENDATION: () => [],
  BEHAVIORAL: (x) => [`A real situation that demonstrates ${x}`, "Actions the candidate personally took", "Outcome and reflection"],
  COMMUNICATION: () => ["Structured explanation", "Language adapted to the audience", "Accurate and concise"],
};

const FOLLOW_UPS: Record<QuestionType, string[]> = {
  RESUME_VERIFICATION: [
    "If the answer describes team work, ask what the candidate personally owned.",
    "If details are thin, ask for one concrete technical decision and its alternative.",
    "If details differ from the resume claim, note the difference for the recruiter — do not conclude dishonesty.",
  ],
  FUNDAMENTAL: [
    "If the answer stays abstract, ask for one concrete example.",
    "If the answer is strong, ask about a common pitfall and how to avoid it.",
  ],
  ADVANCED: [
    "Ask which option they would choose first and why.",
    "Ask how they would verify the fix worked.",
  ],
  SCENARIO: [
    "If they jump to a solution, ask what they would clarify first.",
    "Ask which risk worries them most and how they would reduce it.",
  ],
  TECHNICAL_REASONING: [
    "Ask what would change their decision.",
    "Ask for the main downside of the option they chose.",
  ],
  PRACTICAL_RECOMMENDATION: [
    "After the exercise, ask the candidate to explain their trade-offs.",
    "Ask what they would improve with more time.",
  ],
  BEHAVIORAL: [
    "If the story is vague, ask what they personally did.",
    "Ask what they would do differently next time.",
  ],
  COMMUNICATION: [
    "Ask how they would adapt the explanation for a different audience.",
    "Ask what they chose to leave out and why.",
  ],
};

function roleLabel(classification: RoleClassification): string {
  if (classification.roleFamily === "HYBRID") {
    return classification.secondaryFamilies.map((f) => ROLE_TAXONOMY[f].label).join(" / ") + " professional";
  }
  if (classification.roleFamily === "UNKNOWN") return "member of this team";
  return `${ROLE_TAXONOMY[classification.roleFamily].label} professional`;
}

function sourceFor(c: Competency): QuestionSource {
  if (c.source === "ROLE_STANDARD") {
    return c.category === "LEADERSHIP" && /level/i.test(c.explanation) ? "SENIORITY" : "ROLE";
  }
  return c.jdEvidence.some((e) => e.field === "description") ? "JD" : "SKILL";
}

function isTechnicalRole(classification: RoleClassification): boolean {
  const fams =
    classification.roleFamily === "HYBRID"
      ? classification.secondaryFamilies
      : classification.roleFamily === "UNKNOWN"
        ? []
        : [classification.roleFamily];
  return fams.some((f) => ROLE_TAXONOMY[f].technical);
}

export function generateQuestions(params: {
  analysis: JdAnalysis;
  classification: RoleClassification;
  competencies: Competency[];
  plan: AssessmentPlan;
  resume: ResumeGrounding;
  practical: PracticalRecommendation;
}): QuestionSpec[] {
  const { analysis, classification, competencies, plan, resume, practical } = params;
  const seniority = analysis.seniority;
  const junior = seniority === "INTERN" || seniority === "JUNIOR";
  const technical = isTechnicalRole(classification);
  const gapIds = new Set(resume.insufficient.map((i) => i.competencyId));
  const label = roleLabel(classification);
  const out: QuestionSpec[] = [];

  const build = (
    stage: PlanStage,
    index: number,
    c: Competency,
    type: QuestionType,
    purpose: QuestionPurpose,
    text: string,
    source: QuestionSource,
    resumeEvidence: ResumeEvidence[] = [],
    extraAssumptions: string[] = [],
    expectedOverride?: string[],
  ) => {
    const { difficulty, rationale } = difficultyFor(seniority, c.importance, type);
    const jd = source === "JD" || source === "SKILL" || source === "RESUME" ? c.jdEvidence.slice(0, 3) : [];
    const assumptions = [...STANDARD_DISALLOWED_ASSUMPTIONS, ...extraAssumptions];
    if (junior) assumptions.push("Do not expect production-scale or leadership experience from a junior candidate.");
    out.push({
      id: `q-${stage.type.toLowerCase().replace(/_/g, "-")}-${index + 1}-${c.id.slice(2)}`.slice(0, 120),
      stageId: stage.id,
      text,
      type,
      competency: c.name,
      competencyId: c.id,
      difficulty,
      difficultyRationale: rationale,
      source,
      sourceEvidence: { jd, resume: resumeEvidence },
      purpose,
      expectedEvidence: expectedOverride ?? EXPECTED[type](c.name),
      followUpRules: [...FOLLOW_UPS[type]],
      rubric: rubricFor(type, c.name),
      disallowedAssumptions: assumptions,
    });
  };

  for (const stage of plan.stages) {
    const stageCompetencies = stage.competencyIds
      .map((id) => competencies.find((c) => c.id === id))
      .filter((c): c is Competency => Boolean(c))
      .slice(0, stage.questionCount);

    stageCompetencies.forEach((c, i) => {
      switch (stage.type) {
        case "RESUME_VERIFICATION": {
          const ev = resume.byCompetency.find((r) => r.competencyId === c.id)?.evidence ?? [];
          const chosen = ev.find((e) => e.strength === "STRONG") ?? ev[0];
          if (!chosen) return;
          const text =
            chosen.field === "resumeText"
              ? `Your resume states: "${chosen.quote}". Walk me through what you personally did there, the key decisions you made about ${c.name}, and how you knew it worked.`
              : `Your profile lists "${chosen.quote}". Describe a specific piece of work where you used ${c.name}: what you built, a problem you hit, and how you solved it.`;
          build(stage, i, c, "RESUME_VERIFICATION", "VERIFY_CLAIM", text, "RESUME", [chosen], [
            "Do not treat the resume claim as verified until the answer supports it.",
          ]);
          return;
        }
        case "FOUNDATIONS": {
          if (gapIds.has(c.id)) {
            build(stage, i, c, "FUNDAMENTAL", "PROBE_GAP", PROBE_GAP(c.name), "JD", [], [
              "Do not treat missing resume evidence as missing skill.",
            ]);
            return;
          }
          build(stage, i, c, "FUNDAMENTAL", "ASSESS_FOUNDATION", FUNDAMENTAL[themeOf(c)](c.name), sourceFor(c));
          return;
        }
        case "ADVANCED": {
          const order: QuestionType[] = technical
            ? ["ADVANCED", "SCENARIO", "TECHNICAL_REASONING"]
            : ["SCENARIO", "ADVANCED", "TECHNICAL_REASONING"];
          const type = order[i % order.length];
          const text =
            type === "ADVANCED"
              ? ADVANCED[themeOf(c)](c.name)
              : type === "SCENARIO"
                ? SCENARIO(c.name, label)
                : REASONING(c.name);
          build(stage, i, c, type, type === "SCENARIO" ? "ASSESS_JUDGMENT" : "ASSESS_DEPTH", text, sourceFor(c));
          return;
        }
        case "PRACTICAL": {
          const brief = PRACTICAL_BRIEF[practical.type](c.name);
          build(
            stage,
            i,
            c,
            "PRACTICAL_RECOMMENDATION",
            "ASSESS_PRACTICAL",
            `Recommended practical — ${practical.title}: ${brief} (Recommendation only; HireOS V1 does not run or grade this exercise.)`,
            c.source === "ROLE_STANDARD" ? "ROLE" : sourceFor(c),
            [],
            ["Do not score the practical automatically; a reviewer evaluates the work product."],
            practical.expectedEvidence,
          );
          return;
        }
        case "BEHAVIORAL": {
          const isComm = c.category === "COMMUNICATION";
          const juniorNote = junior ? " Work, internship, academic or personal projects all count." : "";
          const text = isComm
            ? `Explain a technical or work decision you were involved in as if to a non-specialist stakeholder, in under two minutes. What did you leave out, and why?${juniorNote}`
            : `Tell me about a time you demonstrated ${c.name.toLowerCase()} under pressure. What was the situation, what did you personally do, and what was the result?${juniorNote}`;
          build(
            stage,
            i,
            c,
            isComm ? "COMMUNICATION" : "BEHAVIORAL",
            isComm ? "ASSESS_COMMUNICATION" : "ASSESS_COLLABORATION",
            text,
            c.source === "ROLE_STANDARD" ? "ROLE" : sourceFor(c),
          );
          return;
        }
        case "LEADERSHIP": {
          build(
            stage,
            i,
            c,
            "BEHAVIORAL",
            "ASSESS_LEADERSHIP",
            i === 0
              ? `Tell me about a time you led others through a difficult technical or delivery decision. How did you align people, and what would you do differently?`
              : `Describe how you have helped someone on your team grow. What did you do, and how did you know it worked?`,
            sourceFor(c),
          );
          return;
        }
      }
    });
  }
  return out;
}
