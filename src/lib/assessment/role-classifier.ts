import { ROLE_TAXONOMY } from "./taxonomy";
import type { ConcreteRoleFamily, JdAnalysis, RoleClassification } from "./types";

const TITLE_WEIGHT = 6;
const SKILL_REQUIRED_WEIGHT = 1;
const SKILL_PREFERRED_WEIGHT = 0.5;
const SKILL_CAP = 6;
const KEYWORD_WEIGHT = 0.5;
const KEYWORD_CAP = 2;

/** Below this the evidence is too thin to name a family. */
export const UNKNOWN_THRESHOLD = 3;
/** Runner-up within this ratio of the leader (and with its own title evidence) ⇒ HYBRID. */
const HYBRID_RATIO = 0.75;

type FamilyScore = {
  family: ConcreteRoleFamily;
  score: number;
  titleHit: string | null;
  skillHits: string[];
  keywordHits: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function scoreFamilies(analysis: JdAnalysis, descriptionStatements: string[]): FamilyScore[] {
  const required = new Set(analysis.requiredSkills.map((s) => s.skill));
  const preferred = new Set(analysis.preferredSkills.map((s) => s.skill));
  const scores: FamilyScore[] = [];

  for (const [family, def] of Object.entries(ROLE_TAXONOMY) as [ConcreteRoleFamily, (typeof ROLE_TAXONOMY)[ConcreteRoleFamily]][]) {
    const titleMatch = analysis.title.match(def.titleSignals);
    const skillHits: string[] = [];
    let skillScore = 0;
    for (const s of def.skillSignals) {
      if (required.has(s)) {
        skillScore += SKILL_REQUIRED_WEIGHT;
        skillHits.push(s);
      } else if (preferred.has(s)) {
        skillScore += SKILL_PREFERRED_WEIGHT;
        skillHits.push(s);
      }
    }
    const keywordHits = descriptionStatements.filter((t) => def.keywordSignals.test(t)).length;
    const score =
      (titleMatch ? TITLE_WEIGHT : 0) +
      Math.min(skillScore, SKILL_CAP) +
      Math.min(keywordHits * KEYWORD_WEIGHT, KEYWORD_CAP);
    scores.push({ family, score, titleHit: titleMatch ? titleMatch[0] : null, skillHits, keywordHits });
  }

  // Full-stack from skills: needs real frontend AND backend evidence, not one API mention.
  const fe = scores.find((s) => s.family === "FRONTEND_ENGINEERING")!;
  const be = scores.find((s) => s.family === "BACKEND_ENGINEERING")!;
  const fs = scores.find((s) => s.family === "FULLSTACK_ENGINEERING")!;
  const feSkill = Math.min(fe.skillHits.length, SKILL_CAP);
  const beSkill = Math.min(be.skillHits.length, SKILL_CAP);
  if (feSkill >= 2 && beSkill >= 2 && !fe.titleHit && !be.titleHit) {
    fs.score += Math.min(feSkill + beSkill, SKILL_CAP + 2);
    fs.skillHits = [...fe.skillHits, ...be.skillHits];
  } else if (fs.titleHit) {
    fs.score += Math.min(feSkill + beSkill, SKILL_CAP);
    fs.skillHits = [...fe.skillHits, ...be.skillHits];
  }

  return scores.sort((a, b) => b.score - a.score);
}

function describe(s: FamilyScore): string[] {
  const out: string[] = [];
  if (s.titleHit) out.push(`Title "${s.titleHit}" matches ${ROLE_TAXONOMY[s.family].label}`);
  if (s.skillHits.length) {
    out.push(`JD skills: ${s.skillHits.slice(0, 6).join(", ")}${s.skillHits.length > 6 ? "…" : ""}`);
  }
  if (s.keywordHits) out.push(`${s.keywordHits} description statement(s) use ${ROLE_TAXONOMY[s.family].label} language`);
  return out;
}

export function classifyRole(analysis: JdAnalysis, descriptionStatements: string[] = []): RoleClassification {
  const statements = descriptionStatements.length
    ? descriptionStatements
    : analysis.responsibilities.map((r) => r.text);
  const ranked = scoreFamilies(analysis, statements);
  const [top, second] = ranked;
  const scores = ranked.filter((s) => s.score > 0).slice(0, 5).map((s) => ({ family: s.family, score: round2(s.score) }));

  if (!top || top.score < UNKNOWN_THRESHOLD) {
    return {
      roleFamily: "UNKNOWN",
      confidence: round2(Math.min(0.3, (top?.score ?? 0) / 10)),
      evidence: [
        "Not enough title or skill evidence to assign a role family; using general competencies.",
        ...(top && top.score > 0 ? describe(top).map((e) => `Weak signal — ${e}`) : []),
      ],
      secondaryFamilies: top && top.score > 0 ? [top.family] : [],
      scores,
    };
  }

  const secondStrong =
    second &&
    second.score >= UNKNOWN_THRESHOLD &&
    second.score >= top.score * HYBRID_RATIO &&
    !(top.family === "FULLSTACK_ENGINEERING" && (second.family === "FRONTEND_ENGINEERING" || second.family === "BACKEND_ENGINEERING"));

  // A runner-up only makes the role HYBRID if it has comparable title evidence or the
  // leader has none; a clear title wins over skill overlap.
  const isHybrid = Boolean(secondStrong && (second!.titleHit || !top.titleHit));

  const margin = second ? top.score / (top.score + second.score) : 1;
  const evidenceFactor = Math.min(1, top.score / 10);
  let confidence = 0.5 * margin + 0.5 * evidenceFactor;
  if (isHybrid) confidence = Math.min(confidence, 0.7);
  confidence = round2(Math.max(0.05, Math.min(0.95, confidence)));

  if (isHybrid) {
    return {
      roleFamily: "HYBRID",
      confidence,
      evidence: [
        `Evidence for both ${ROLE_TAXONOMY[top.family].label} and ${ROLE_TAXONOMY[second!.family].label}`,
        ...describe(top),
        ...describe(second!),
      ],
      secondaryFamilies: [top.family, second!.family],
      scores,
    };
  }

  const runnerUps = ranked
    .slice(1, 3)
    .filter((s) => s.score >= UNKNOWN_THRESHOLD && s.score >= top.score * 0.5)
    .map((s) => s.family);

  return {
    roleFamily: top.family,
    confidence,
    evidence: describe(top),
    secondaryFamilies: runnerUps,
    scores,
  };
}
