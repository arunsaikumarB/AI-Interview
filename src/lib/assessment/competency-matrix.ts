import { lookupSkill, type SkillCategory } from "./skills";
import {
  COMMON_COMPETENCIES,
  familyLabel,
  LEADERSHIP_COMPETENCY,
  ROLE_TAXONOMY,
  UNKNOWN_FAMILY_STANDARD,
  type StandardCompetency,
} from "./taxonomy";
import type {
  Competency,
  CompetencyCategory,
  ExpectedLevel,
  Importance,
  JdAnalysis,
  JdEvidence,
  JdSkill,
  RoleClassification,
  Seniority,
} from "./types";

const IMPORTANCE_RANK: Record<Importance, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const MAX_JD_COMPETENCIES = 10;
const MAX_ROLE_STANDARD = 4;

const LEVEL_TABLE: Record<Seniority, Record<Importance, ExpectedLevel>> = {
  INTERN: { CRITICAL: "FOUNDATIONAL", HIGH: "FOUNDATIONAL", MEDIUM: "FOUNDATIONAL", LOW: "FOUNDATIONAL" },
  JUNIOR: { CRITICAL: "WORKING", HIGH: "WORKING", MEDIUM: "FOUNDATIONAL", LOW: "FOUNDATIONAL" },
  MID: { CRITICAL: "ADVANCED", HIGH: "WORKING", MEDIUM: "WORKING", LOW: "FOUNDATIONAL" },
  SENIOR: { CRITICAL: "ADVANCED", HIGH: "ADVANCED", MEDIUM: "WORKING", LOW: "WORKING" },
  LEAD: { CRITICAL: "EXPERT", HIGH: "ADVANCED", MEDIUM: "ADVANCED", LOW: "WORKING" },
  PRINCIPAL: { CRITICAL: "EXPERT", HIGH: "EXPERT", MEDIUM: "ADVANCED", LOW: "WORKING" },
  UNKNOWN: { CRITICAL: "WORKING", HIGH: "WORKING", MEDIUM: "WORKING", LOW: "FOUNDATIONAL" },
};

export function expectedLevelFor(seniority: Seniority, importance: Importance): ExpectedLevel {
  return LEVEL_TABLE[seniority][importance];
}

function categoryForSkill(skill: string): CompetencyCategory {
  const def = lookupSkill(skill);
  if (def) {
    const c: SkillCategory = def.category;
    if (c === "WRITING") return "COMMUNICATION";
    if (["DESIGN", "PRODUCT", "PROJECT", "ANALYSIS", "SUPPORT", "PRACTICE"].includes(c)) return "PRACTICE";
    return "TECHNICAL";
  }
  if (/communicat|present|writ/i.test(skill)) return "COMMUNICATION";
  if (/lead|mentor|manag(?:e|ing) (?:people|team)/i.test(skill)) return "LEADERSHIP";
  if (/team ?work|collaborat|ownership/i.test(skill)) return "BEHAVIORAL";
  if (/domain|industry/i.test(skill)) return "DOMAIN";
  return "TECHNICAL";
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/\+/g, "plus")
      .replace(/#/g, "sharp")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "competency"
  );
}

function fieldLabel(e: JdEvidence): string {
  switch (e.field) {
    case "mustHave":
      return "must-have list";
    case "niceToHave":
      return "nice-to-have list";
    case "skills":
      return "job skills";
    case "title":
      return "job title";
    case "experienceRange":
      return "experience range";
    default:
      return "description";
  }
}

function jdExplanation(s: JdSkill, level: ExpectedLevel, seniority: Seniority): string {
  const where = Array.from(new Set(s.evidence.map(fieldLabel))).join(", ");
  const why = !s.required
    ? "Preferred in the JD, not a requirement"
    : s.importance === "CRITICAL"
      ? "Critical: listed as a must-have"
      : s.importance === "HIGH"
        ? "Required: listed in the job skills or stated as required"
        : "Required: part of the stated responsibilities";
  const lvl = seniority === "UNKNOWN" ? `Expected ${level} (seniority not stated)` : `Expected ${level} for a ${seniority} role`;
  return `${why} (source: ${where}). ${lvl}.`;
}

export function buildCompetencyMatrix(
  analysis: JdAnalysis,
  classification: RoleClassification,
): Competency[] {
  const out: Competency[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  const seniority = analysis.seniority;

  const push = (c: Omit<Competency, "id">) => {
    const key = c.name.toLowerCase();
    if (usedNames.has(key)) return;
    let id = `c-${slug(c.name)}`;
    for (let i = 2; usedIds.has(id); i++) id = `c-${slug(c.name)}-${i}`;
    usedIds.add(id);
    usedNames.add(key);
    out.push({ id, ...c });
  };

  const jdSkills = [...analysis.requiredSkills, ...analysis.preferredSkills]
    .sort((a, b) => Number(b.required) - Number(a.required) || IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance])
    .slice(0, MAX_JD_COMPETENCIES);

  for (const s of jdSkills) {
    const level = expectedLevelFor(seniority, s.importance);
    push({
      name: s.skill,
      category: categoryForSkill(s.skill),
      source: s.required ? "JD_REQUIRED" : "JD_PREFERRED",
      importance: s.importance,
      expectedLevel: level,
      explanation: jdExplanation(s, level, seniority),
      jdEvidence: s.evidence.slice(0, 4),
    });
  }

  if (analysis.leadership.expected) {
    push({
      name: LEADERSHIP_COMPETENCY.name,
      category: "LEADERSHIP",
      source: "JD_REQUIRED",
      importance: "HIGH",
      expectedLevel: expectedLevelFor(seniority, "HIGH"),
      explanation: "The JD describes leading, mentoring or managing others.",
      jdEvidence: analysis.leadership.evidence.slice(0, 3).map((text) => ({ field: "description", text })),
    });
  }
  if (analysis.communication.expected) {
    push({
      name: "Communication",
      category: "COMMUNICATION",
      source: "JD_REQUIRED",
      importance: "MEDIUM",
      expectedLevel: expectedLevelFor(seniority, "MEDIUM"),
      explanation: "The JD calls out communication, stakeholder or cross-functional work.",
      jdEvidence: analysis.communication.evidence.slice(0, 3).map((text) => ({ field: "description", text })),
    });
  }

  const families =
    classification.roleFamily === "HYBRID"
      ? classification.secondaryFamilies
      : classification.roleFamily === "UNKNOWN"
        ? []
        : [classification.roleFamily];

  const standard: { std: StandardCompetency; family: string }[] =
    families.length === 0
      ? UNKNOWN_FAMILY_STANDARD.map((std) => ({ std, family: "UNKNOWN" }))
      : families.flatMap((f) => ROLE_TAXONOMY[f].standard.map((std) => ({ std, family: f })));

  let roleStandardCount = 0;
  for (const { std, family } of standard) {
    if (roleStandardCount >= MAX_ROLE_STANDARD * Math.max(1, families.length)) break;
    if (usedNames.has(std.name.toLowerCase())) continue;
    const importance: Importance = std.importance === "CRITICAL" ? "HIGH" : std.importance;
    push({
      name: std.name,
      category: std.category,
      source: "ROLE_STANDARD",
      importance,
      expectedLevel: expectedLevelFor(seniority, importance),
      explanation:
        family === "UNKNOWN"
          ? `General competency used because the role family is unknown. ${std.description}`
          : `Standard for ${familyLabel(family)}; not explicitly stated in this JD. ${std.description}`,
      jdEvidence: [],
    });
    roleStandardCount++;
  }

  if (!analysis.leadership.expected && (seniority === "LEAD" || seniority === "PRINCIPAL")) {
    push({
      name: LEADERSHIP_COMPETENCY.name,
      category: "LEADERSHIP",
      source: "ROLE_STANDARD",
      importance: "MEDIUM",
      expectedLevel: expectedLevelFor(seniority, "MEDIUM"),
      explanation: `Expected at ${seniority} level even though the JD does not state it. ${LEADERSHIP_COMPETENCY.description}`,
      jdEvidence: [],
    });
  }

  for (const std of COMMON_COMPETENCIES) {
    push({
      name: std.name,
      category: std.category,
      source: "ROLE_STANDARD",
      importance: std.importance,
      expectedLevel: expectedLevelFor(seniority, std.importance),
      explanation: `Baseline competency for every role. ${std.description}`,
      jdEvidence: [],
    });
  }

  for (const d of analysis.domains.slice(0, 1)) {
    push({
      name: `Domain context: ${d.name}`,
      category: "DOMAIN",
      source: "JD_PREFERRED",
      importance: "LOW",
      expectedLevel: "FOUNDATIONAL",
      explanation: "The JD mentions this domain; treat familiarity as helpful, not required.",
      jdEvidence: [{ field: "description", text: d.evidence }],
    });
  }

  const sourceRank = { JD_REQUIRED: 3, JD_PREFERRED: 1, ROLE_STANDARD: 2 } as const;
  return out.sort(
    (a, b) =>
      IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance] ||
      sourceRank[b.source] - sourceRank[a.source],
  );
}

export function standardFor(name: string): StandardCompetency | undefined {
  for (const def of Object.values(ROLE_TAXONOMY)) {
    const hit = def.standard.find((s) => s.name === name);
    if (hit) return hit;
  }
  if (name === LEADERSHIP_COMPETENCY.name) return LEADERSHIP_COMPETENCY;
  return [...COMMON_COMPETENCIES, ...UNKNOWN_FAMILY_STANDARD].find((s) => s.name === name);
}
