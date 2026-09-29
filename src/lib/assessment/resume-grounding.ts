import { standardFor } from "./competency-matrix";
import {
  cleanText,
  findProtectedAttributes,
  looksLikeContactDetail,
  looksLikeInstruction,
  normalizeForMatch,
  truncate,
} from "./guardrails";
import { matchersFor } from "./skills";
import type {
  CandidateInput,
  Competency,
  CompetencyResumeEvidence,
  ResumeEvidence,
  ResumeGrounding,
} from "./types";

const MAX_RESUME_CHARS = 50_000;
const MIN_RESUME_CHARS = 40;
const MAX_QUOTES_PER_COMPETENCY = 2;

const ACTION_VERB =
  /\b(built|developed|designed|implemented|led|architected|migrated|optimi[sz]ed|deployed|created|delivered|owned|automated|maintained|wrote|reduced|improved|launched|managed|analy[sz]ed|tested|shipped|refactored|scaled|mentored|researched|configured|integrated|resolved|documented|modell?ed|trained)\b/i;
const METRIC = /\d+\s*(%|percent|x\b|ms\b|users|customers|requests)/i;
const LIST_LINE = /^(skills|technical skills|technologies|tools|tech stack|languages|frameworks)\s*[:|-]/i;

type ResumeLine = { text: string; strong: boolean };

function resumeLines(resumeText: string): { lines: ResumeLine[]; excluded: number } {
  const lines: ResumeLine[] = [];
  let excluded = 0;
  for (const raw of resumeText.slice(0, MAX_RESUME_CHARS).split(/\r?\n/)) {
    const stripped = raw.replace(/^[\s•●▪◦*\-–—·>]+/, "");
    for (const sentence of stripped.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const text = cleanText(sentence);
      if (text.length < 3) continue;
      if (
        findProtectedAttributes(text).length > 0 ||
        looksLikeContactDetail(text) ||
        looksLikeInstruction(text)
      ) {
        excluded++;
        continue;
      }
      const strong = !LIST_LINE.test(text) && (ACTION_VERB.test(text) || METRIC.test(text));
      lines.push({ text, strong });
    }
  }
  return { lines, excluded };
}

function evidenceFor(
  competency: Competency,
  lines: ResumeLine[],
  profileSkills: string[],
): ResumeEvidence[] {
  const std = standardFor(competency.name);
  const matchers = matchersFor(competency.name, std?.resumeSignals ?? []);
  const hits = lines.filter((l) => matchers.some((re) => re.test(l.text)));
  hits.sort((a, b) => Number(b.strong) - Number(a.strong));

  const out: ResumeEvidence[] = hits.slice(0, MAX_QUOTES_PER_COMPETENCY).map((l) => ({
    field: "resumeText",
    // Truncating from the start keeps the quote a verbatim substring of the resume.
    quote: truncate(l.text, 240),
    strength: l.strong ? "STRONG" : "WEAK",
  }));

  if (out.length < MAX_QUOTES_PER_COMPETENCY) {
    const skill = profileSkills.find((s) => matchers.some((re) => re.test(s)));
    if (skill) out.push({ field: "profileSkills", quote: cleanText(skill), strength: "WEAK" });
  }
  return out;
}

/**
 * Finds verbatim resume evidence per competency. Never paraphrases or infers:
 * no match ⇒ NONE, and key JD competencies are flagged INSUFFICIENT_RESUME_EVIDENCE.
 */
export function groundResume(
  candidate: CandidateInput | null,
  competencies: Competency[],
): ResumeGrounding {
  if (!candidate) {
    return { availability: "NO_CANDIDATE", byCompetency: [], insufficient: [], excludedLineCount: 0 };
  }

  const text = candidate.resumeText ?? "";
  const skills = candidate.skills
    .filter(
      (s) =>
        typeof s === "string" &&
        s.trim().length > 0 &&
        s.length <= 120 &&
        findProtectedAttributes(s).length === 0,
    )
    .slice(0, 60);
  const hasResume = cleanText(text).length >= MIN_RESUME_CHARS;

  const keyCompetencies = competencies.filter(
    (c) => c.source === "JD_REQUIRED" && (c.importance === "CRITICAL" || c.importance === "HIGH"),
  );

  if (!hasResume && skills.length === 0) {
    return {
      availability: "NO_RESUME",
      byCompetency: competencies.map((c) => ({ competencyId: c.id, competency: c.name, strength: "NONE", evidence: [] })),
      insufficient: keyCompetencies.map((c) => ({
        competencyId: c.id,
        competency: c.name,
        reason: "INSUFFICIENT_RESUME_EVIDENCE",
        detail: "No resume text or profile skills on file.",
      })),
      excludedLineCount: 0,
    };
  }

  const { lines, excluded } = hasResume ? resumeLines(text) : { lines: [], excluded: 0 };
  const byCompetency: CompetencyResumeEvidence[] = competencies
    .filter((c) => c.category !== "BEHAVIORAL" && c.category !== "COMMUNICATION")
    .map((c) => {
      const evidence = evidenceFor(c, lines, skills);
      const strength = evidence.some((e) => e.strength === "STRONG")
        ? "STRONG"
        : evidence.length
          ? "WEAK"
          : "NONE";
      return { competencyId: c.id, competency: c.name, strength, evidence };
    });

  const insufficient = keyCompetencies
    .filter((c) => (byCompetency.find((b) => b.competencyId === c.id)?.strength ?? "NONE") === "NONE")
    .map((c) => ({
      competencyId: c.id,
      competency: c.name,
      reason: "INSUFFICIENT_RESUME_EVIDENCE" as const,
      detail: hasResume
        ? "The resume does not mention this required competency."
        : "Only profile skills are available and they do not mention this competency.",
    }));

  return { availability: "ANALYZED", byCompetency, insufficient, excludedLineCount: excluded };
}

/** True when `quote` appears verbatim (whitespace/case-normalised) in the resume. */
export function quoteInResume(quote: string, resumeText: string | null): boolean {
  if (!resumeText) return false;
  return normalizeForMatch(resumeText).includes(normalizeForMatch(quote));
}
