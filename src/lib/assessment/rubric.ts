import type { QuestionType, RubricCriterion } from "./types";

type Template = { name: string; description: string; weight: number; evidence: string[] }[];

function templates(competency: string): Record<QuestionType, Template> {
  return {
    RESUME_VERIFICATION: [
      {
        name: "Personal contribution",
        description: "Separates what the candidate personally did from what the team did.",
        weight: 35,
        evidence: ["Names specific tasks or decisions they owned", "Uses first-person, concrete detail"],
      },
      {
        name: "Technical accuracy",
        description: `Details about ${competency} are correct and consistent with the claimed work.`,
        weight: 30,
        evidence: ["Correct terminology and mechanics", "No contradictions when probed"],
      },
      {
        name: "Consistency with the resume claim",
        description: "The account supports the quoted resume statement at the claimed scope.",
        weight: 20,
        evidence: ["Scope and timeline match the claim", "Inconsistencies are noted, not judged"],
      },
      {
        name: "Outcome awareness",
        description: "Explains the result and how it was measured, or honestly says it was not.",
        weight: 15,
        evidence: ["A measurable or observable outcome", "Reflection on what they would change"],
      },
    ],
    FUNDAMENTAL: [
      {
        name: "Conceptual accuracy",
        description: `Core ${competency} concepts are explained correctly.`,
        weight: 45,
        evidence: ["Correct definitions", "Knows when the concept applies"],
      },
      {
        name: "Practical example",
        description: "Grounds the explanation in a concrete, correct example.",
        weight: 30,
        evidence: ["Example is specific", "Example actually illustrates the concept"],
      },
      {
        name: "Clarity",
        description: "Explanation is structured and easy to follow.",
        weight: 25,
        evidence: ["Logical order", "No unnecessary jargon"],
      },
    ],
    ADVANCED: [
      {
        name: "Depth and correctness",
        description: `Shows depth in ${competency} beyond surface-level usage.`,
        weight: 40,
        evidence: ["Accurate internals or mechanisms", "Systematic diagnosis steps"],
      },
      {
        name: "Trade-off reasoning",
        description: "Compares options and justifies a choice.",
        weight: 35,
        evidence: ["At least two options considered", "Costs and benefits stated"],
      },
      {
        name: "Failure modes",
        description: "Anticipates edge cases, risks and how to detect problems.",
        weight: 25,
        evidence: ["Edge cases named", "Monitoring or verification plan"],
      },
    ],
    SCENARIO: [
      {
        name: "Problem framing",
        description: "Clarifies goals, constraints and unknowns before solving.",
        weight: 25,
        evidence: ["Asks or states clarifying questions", "Identifies constraints"],
      },
      {
        name: "Approach quality",
        description: `Proposes a sound, workable approach using ${competency}.`,
        weight: 40,
        evidence: ["Steps are ordered and feasible", "Approach fits the constraints"],
      },
      {
        name: "Risks and trade-offs",
        description: "Flags risks and what they would sacrifice.",
        weight: 20,
        evidence: ["Risks named with mitigations"],
      },
      {
        name: "Communication",
        description: "Explains the plan clearly to the interviewer.",
        weight: 15,
        evidence: ["Structured, concise explanation"],
      },
    ],
    TECHNICAL_REASONING: [
      {
        name: "Reasoning correctness",
        description: `Reasoning about ${competency} is technically sound.`,
        weight: 45,
        evidence: ["Correct facts", "Valid conclusions"],
      },
      {
        name: "Structured approach",
        description: "Works through the problem in a clear sequence.",
        weight: 30,
        evidence: ["Explicit steps", "Checks assumptions"],
      },
      {
        name: "Justification",
        description: "Explains why the chosen approach fits the context.",
        weight: 25,
        evidence: ["Decision criteria stated"],
      },
    ],
    PRACTICAL_RECOMMENDATION: [
      {
        name: "Correctness",
        description: "The work product meets the stated requirements.",
        weight: 40,
        evidence: ["Requirements covered", "No major functional errors"],
      },
      {
        name: "Approach",
        description: "The approach is reasonable and explained.",
        weight: 30,
        evidence: ["Reasoning shared", "Sensible structure"],
      },
      {
        name: "Quality",
        description: "Attention to maintainability, edge cases and clarity.",
        weight: 30,
        evidence: ["Edge cases considered", "Readable result"],
      },
    ],
    BEHAVIORAL: [
      {
        name: "Situation clarity",
        description: "Describes a real situation with enough context.",
        weight: 20,
        evidence: ["Specific situation and stakes"],
      },
      {
        name: "Personal actions",
        description: `Explains what they personally did to demonstrate ${competency}.`,
        weight: 40,
        evidence: ["First-person actions", "Reasons for those actions"],
      },
      {
        name: "Outcome and reflection",
        description: "Shares the outcome and what they learned.",
        weight: 40,
        evidence: ["Observable result", "Honest reflection"],
      },
    ],
    COMMUNICATION: [
      {
        name: "Structure",
        description: "Organises the message logically.",
        weight: 35,
        evidence: ["Clear beginning, middle and end"],
      },
      {
        name: "Audience awareness",
        description: "Adapts depth and vocabulary to the audience.",
        weight: 35,
        evidence: ["Avoids or explains jargon", "Focuses on what the audience needs"],
      },
      {
        name: "Clarity and concision",
        description: "Gets to the point without losing accuracy.",
        weight: 30,
        evidence: ["Concise", "Accurate"],
      },
    ],
  };
}

export function rubricFor(type: QuestionType, competency: string): RubricCriterion[] {
  return templates(competency)[type].map((c) => ({ ...c, evidence: [...c.evidence] }));
}

export function validateRubric(rubric: { name?: unknown; weight?: unknown }[]): {
  ok: boolean;
  total: number;
  issues: string[];
} {
  const issues: string[] = [];
  let total = 0;
  const names = new Set<string>();
  if (!Array.isArray(rubric) || rubric.length < 2) {
    issues.push("Rubric needs at least two criteria");
  }
  for (const c of Array.isArray(rubric) ? rubric : []) {
    const w = c?.weight;
    if (typeof w !== "number" || !Number.isInteger(w) || w <= 0) {
      issues.push(`Criterion "${String(c?.name ?? "?")}" has an invalid weight`);
      continue;
    }
    total += w;
    const n = String(c?.name ?? "").trim().toLowerCase();
    if (!n) issues.push("Criterion is missing a name");
    else if (names.has(n)) issues.push(`Duplicate criterion "${n}"`);
    names.add(n);
  }
  if (total !== 100) issues.push(`Criterion weights total ${total}, expected 100`);
  return { ok: issues.length === 0, total, issues };
}
