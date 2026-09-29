import { difficultyFor } from "./difficulty";
import { familyLabel, ROLE_TAXONOMY, UNKNOWN_PRACTICAL } from "./taxonomy";
import type {
  Competency,
  PracticalRecommendation,
  RoleClassification,
  Seniority,
} from "./types";

const MINUTES: Record<Seniority, number> = {
  INTERN: 30,
  JUNIOR: 45,
  MID: 60,
  SENIOR: 75,
  LEAD: 75,
  PRINCIPAL: 90,
  UNKNOWN: 60,
};

/**
 * Recommends — never runs — a practical exercise format for the role.
 * V1 has no coding sandbox, SQL runner or design workspace.
 */
export function recommendPractical(
  classification: RoleClassification,
  seniority: Seniority,
  competencies: Competency[],
): PracticalRecommendation {
  const primary =
    classification.roleFamily === "HYBRID"
      ? classification.secondaryFamilies[0]
      : classification.roleFamily === "UNKNOWN"
        ? null
        : classification.roleFamily;

  const template = primary ? ROLE_TAXONOMY[primary].practical : UNKNOWN_PRACTICAL;
  const target =
    competencies.find((c) => c.name === template.competency) ??
    competencies.find((c) => c.source === "JD_REQUIRED" && c.category === "TECHNICAL") ??
    competencies[0];

  const { difficulty } = difficultyFor(seniority, target?.importance ?? "HIGH", "PRACTICAL_RECOMMENDATION");

  let reason = template.reason;
  if (classification.roleFamily === "HYBRID" && classification.secondaryFamilies[1]) {
    const other = ROLE_TAXONOMY[classification.secondaryFamilies[1]].practical;
    reason += ` Hybrid role: consider a second, shorter ${other.title.toLowerCase()} for the ${familyLabel(classification.secondaryFamilies[1])} side.`;
  }
  if (target && target.name !== template.competency && target.source === "JD_REQUIRED") {
    reason += ` Anchor the exercise on ${target.name}, which the JD requires.`;
  }

  return {
    type: template.type,
    title: template.title,
    competency: target?.name ?? template.competency,
    reason,
    expectedEvidence: [...template.expectedEvidence],
    estimatedDifficulty: difficulty,
    estimatedMinutes: MINUTES[seniority],
    executionSupported: false,
  };
}
