import { ROLE_TAXONOMY } from "./taxonomy";
import type {
  AssessmentPlan,
  Competency,
  Importance,
  JdAnalysis,
  PlanStage,
  PracticalRecommendation,
  ResumeGrounding,
  RoleClassification,
  Seniority,
  StageType,
} from "./types";

const IMPORTANCE_RANK: Record<Importance, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

type Profile = { foundations: number; advanced: number; behavioral: number; leadership: number };

const PROFILES: Record<Seniority, Profile> = {
  INTERN: { foundations: 4, advanced: 0, behavioral: 2, leadership: 0 },
  JUNIOR: { foundations: 4, advanced: 1, behavioral: 2, leadership: 0 },
  MID: { foundations: 3, advanced: 2, behavioral: 2, leadership: 0 },
  SENIOR: { foundations: 2, advanced: 3, behavioral: 1, leadership: 1 },
  LEAD: { foundations: 1, advanced: 3, behavioral: 1, leadership: 2 },
  PRINCIPAL: { foundations: 1, advanced: 3, behavioral: 1, leadership: 2 },
  UNKNOWN: { foundations: 3, advanced: 2, behavioral: 2, leadership: 0 },
};

const MINUTES_PER_QUESTION: Record<StageType, number> = {
  RESUME_VERIFICATION: 5,
  FOUNDATIONS: 4,
  ADVANCED: 7,
  PRACTICAL: 0,
  BEHAVIORAL: 5,
  LEADERSHIP: 6,
};

function byImportance(a: Competency, b: Competency): number {
  const src = { JD_REQUIRED: 3, ROLE_STANDARD: 2, JD_PREFERRED: 1 } as const;
  return IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance] || src[b.source] - src[a.source];
}

function isTechnicalFamily(classification: RoleClassification): boolean {
  const families =
    classification.roleFamily === "HYBRID"
      ? classification.secondaryFamilies
      : classification.roleFamily === "UNKNOWN"
        ? []
        : [classification.roleFamily];
  return families.some((f) => ROLE_TAXONOMY[f].technical);
}

export function buildAssessmentPlan(params: {
  analysis: JdAnalysis;
  classification: RoleClassification;
  competencies: Competency[];
  resume: ResumeGrounding;
  practical: PracticalRecommendation;
}): AssessmentPlan {
  const { analysis, classification, competencies, resume, practical } = params;
  const seniority = analysis.seniority;
  const profile = { ...PROFILES[seniority] };
  const rationale: string[] = [];

  if (classification.roleFamily === "ENGINEERING_MANAGEMENT") profile.leadership = Math.max(profile.leadership, 2);
  if (analysis.leadership.expected) profile.leadership = Math.max(profile.leadership, 1);

  const core = competencies
    .filter((c) => c.category === "TECHNICAL" || c.category === "PRACTICE" || c.category === "DOMAIN")
    .sort(byImportance);
  const behavioral = competencies.filter((c) => c.category === "BEHAVIORAL" || c.category === "COMMUNICATION").sort(byImportance);
  const leadership = competencies.filter((c) => c.category === "LEADERSHIP").sort(byImportance);

  const stages: PlanStage[] = [];
  const add = (s: Omit<PlanStage, "estimatedMinutes">) => {
    if (s.questionCount <= 0) return;
    stages.push({ ...s, estimatedMinutes: s.questionCount * MINUTES_PER_QUESTION[s.type] });
  };

  // Resume verification — only where verbatim resume evidence exists.
  if (resume.availability === "ANALYZED") {
    const evidenced = resume.byCompetency
      .filter((r) => r.strength !== "NONE")
      .map((r) => ({ r, c: competencies.find((c) => c.id === r.competencyId) }))
      .filter((x): x is { r: (typeof resume.byCompetency)[number]; c: Competency } => Boolean(x.c))
      .sort((a, b) => Number(b.r.strength === "STRONG") - Number(a.r.strength === "STRONG") || byImportance(a.c, b.c));
    // One question per distinct resume statement — several competencies often match the same line.
    const usedQuotes = new Set<string>();
    const picked: Competency[] = [];
    for (const { r, c } of evidenced) {
      const quote = (r.evidence.find((e) => e.strength === "STRONG") ?? r.evidence[0])?.quote;
      if (!quote || usedQuotes.has(quote)) continue;
      usedQuotes.add(quote);
      picked.push(c);
      if (picked.length === 3) break;
    }
    if (picked.length > 0) {
      add({
        id: "stage-resume",
        type: "RESUME_VERIFICATION",
        title: "Resume verification",
        purpose: "Verify specific resume claims that relate to required competencies.",
        questionCount: picked.length,
        competencyIds: picked.map((c) => c.id),
        rationale: `${evidenced.length} competenc${evidenced.length === 1 ? "y has" : "ies have"} verbatim resume evidence; verifying ${picked.length} distinct claim(s), strongest first.`,
      });
    } else {
      rationale.push("Resume verification skipped: the resume has no evidence for the competencies in this plan.");
    }
    if (resume.insufficient.length) {
      rationale.push(
        `${resume.insufficient.length} required competenc${resume.insufficient.length === 1 ? "y has" : "ies have"} insufficient resume evidence; foundation questions probe them without assuming experience.`,
      );
    }
  } else if (resume.availability === "NO_RESUME") {
    rationale.push("Resume verification skipped: the candidate has no resume text or profile skills on file.");
  } else {
    rationale.push("Job-level blueprint: select an application to add resume-grounded questions.");
  }

  // Foundations — gap competencies first so missing evidence is probed, not assumed.
  const gapIds = new Set(resume.insufficient.map((i) => i.competencyId));
  const foundationPool = [...core].sort((a, b) => Number(gapIds.has(b.id)) - Number(gapIds.has(a.id)) || byImportance(a, b));
  const foundationCount = Math.min(profile.foundations + Math.min(gapIds.size, 2), foundationPool.length, 6);
  add({
    id: "stage-foundations",
    type: "FOUNDATIONS",
    title: "Foundations",
    purpose: "Confirm core knowledge of the most important competencies.",
    questionCount: foundationCount,
    competencyIds: foundationPool.slice(0, foundationCount).map((c) => c.id),
    rationale: `${seniority === "UNKNOWN" ? "Seniority unstated" : seniority} profile uses ${profile.foundations} foundation question(s)${gapIds.size ? `, plus up to 2 gap probes` : ""}.`,
  });

  const advancedPool = core.filter((c) => c.importance === "CRITICAL" || c.importance === "HIGH");
  const advancedCount = Math.min(profile.advanced, advancedPool.length || core.length);
  add({
    id: "stage-advanced",
    type: "ADVANCED",
    title: isTechnicalFamily(classification) ? "Depth and scenarios" : "Scenarios and judgment",
    purpose: isTechnicalFamily(classification)
      ? "Probe depth, trade-offs and failure modes at the level the role needs."
      : "Probe judgment through realistic scenarios for this role.",
    questionCount: advancedCount,
    competencyIds: (advancedPool.length ? advancedPool : core).slice(0, advancedCount).map((c) => c.id),
    rationale:
      profile.advanced === 0
        ? "No depth questions for this seniority."
        : `${profile.advanced} depth question(s) for ${seniority === "UNKNOWN" ? "unstated" : seniority} seniority, limited to critical/high competencies.`,
  });

  add({
    id: "stage-practical",
    type: "PRACTICAL",
    title: `Practical: ${practical.title}`,
    purpose: "Recommended hands-on exercise (not run inside HireOS V1).",
    questionCount: 1,
    competencyIds: competencies.filter((c) => c.name === practical.competency).map((c) => c.id).slice(0, 1),
    rationale: practical.reason,
  });

  const behavioralCount = Math.min(profile.behavioral, behavioral.length);
  add({
    id: "stage-behavioral",
    type: "BEHAVIORAL",
    title: "Behavioral and communication",
    purpose: "Understand how the candidate collaborates and communicates.",
    questionCount: behavioralCount,
    competencyIds: behavioral.slice(0, behavioralCount).map((c) => c.id),
    rationale: `${behavioralCount} question(s) on collaboration/communication.`,
  });

  const leadershipCount = Math.min(profile.leadership, leadership.length);
  add({
    id: "stage-leadership",
    type: "LEADERSHIP",
    title: "Leadership",
    purpose: "Assess leading, mentoring and owning outcomes.",
    questionCount: leadershipCount,
    competencyIds: leadership.slice(0, leadershipCount).map((c) => c.id),
    rationale: analysis.leadership.expected
      ? "The JD states leadership expectations."
      : `Expected at ${seniority} level.`,
  });

  const totalQuestions = stages.reduce((n, s) => n + s.questionCount, 0);
  const estimatedMinutes = stages.reduce((n, s) => n + s.estimatedMinutes, 0) + practical.estimatedMinutes;
  rationale.unshift(
    `Plan adapted to ${classification.roleFamily === "UNKNOWN" ? "an unclassified role" : classification.roleFamily.replace(/_/g, " ").toLowerCase()} at ${seniority === "UNKNOWN" ? "unstated" : seniority.toLowerCase()} seniority.`,
  );
  return { stages, totalQuestions, estimatedMinutes, rationale };
}
