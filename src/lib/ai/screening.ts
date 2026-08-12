import { z } from "zod";
import type { AIRecommendation, Job } from "@prisma/client";
import { AIError, chatJSON } from "@/lib/ai/ollama";

/**
 * JD vs Resume advisory screening.
 * NEVER mutates Application.stage or Application.status.
 */

export const ScreeningBreakdownSchema = z.object({
  technicalSkills: z.number().min(0).max(100),
  experience: z.number().min(0).max(100),
  education: z.number().min(0).max(100),
  domainExperience: z.number().min(0).max(100),
  jobRequirements: z.number().min(0).max(100),
});

export const ScreeningResultSchema = z.object({
  overall: z.number().min(0).max(100),
  breakdown: ScreeningBreakdownSchema,
  whyMatch: z.array(z.string().min(1)).min(3).max(6),
  missingRequirements: z.array(z.string()),
  concerns: z.array(z.string()),
  recommendedAction: z.enum(["SHORTLIST", "REVIEW", "REJECT"]),
  reasoning: z.string().min(40),
});

export type ScreeningResult = z.infer<typeof ScreeningResultSchema>;
export type ScreeningBreakdown = z.infer<typeof ScreeningBreakdownSchema>;

export type ScreeningCriteria = {
  mustHave?: string[];
  niceToHave?: string[];
};

export type ScreeningCandidateInput = {
  firstName: string;
  lastName: string;
  summary?: string | null;
  skills: string[];
  experience: number;
  education?: unknown;
  certifications?: unknown;
  /** Locally extracted resume text (from Document/Candidate.resumeText) */
  resumeText?: string | null;
};

const SYSTEM_PROMPT = `You are an advisory hiring screener for a self-hosted ATS.
You NEVER make hiring decisions and you NEVER change application stages.
Score the candidate ONLY against the provided job description and criteria.
Rules:
- Cite concrete evidence from the resume for EVERY whyMatch point.
- Do not invent facts, employers, degrees, or skills not present in the inputs.
- If something is unverifiable from the resume, put it in concerns — do not assume it.
- missingRequirements must list JD/must-have items not evidenced in the resume.
- recommendedAction: SHORTLIST (strong fit), REVIEW (mixed/partial), REJECT (clear mismatch).
- reasoning must be a 3-5 sentence narrative explaining the score.
- Return ONLY valid JSON matching the schema.`;

const HEAD_CHARS = 4000;
const TAIL_CHARS = 2000;
const TRUNCATE_AT = 6000;

export function truncateResumeText(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= TRUNCATE_AT) {
    return { text, truncated: false };
  }
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  return {
    text: `${head}\n\n[... truncated middle for length ...]\n\n${tail}`,
    truncated: true,
  };
}

export function mapRecommendedActionToAIRecommendation(
  action: ScreeningResult["recommendedAction"],
): AIRecommendation {
  switch (action) {
    case "SHORTLIST":
      return "YES";
    case "REVIEW":
      return "MAYBE";
    case "REJECT":
      return "NO";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function asCriteria(raw: unknown): ScreeningCriteria {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  return {
    mustHave: Array.isArray(obj.mustHave)
      ? obj.mustHave.filter((x): x is string => typeof x === "string")
      : [],
    niceToHave: Array.isArray(obj.niceToHave)
      ? obj.niceToHave.filter((x): x is string => typeof x === "string")
      : [],
  };
}

export function buildScreeningUserPrompt(params: {
  job: Pick<
    Job,
    | "title"
    | "description"
    | "skills"
    | "experienceMin"
    | "experienceMax"
    | "screeningCriteria"
  >;
  candidate: ScreeningCandidateInput;
}): string {
  const criteria = asCriteria(params.job.screeningCriteria);
  const rawResume = (params.candidate.resumeText ?? "").trim();
  const { text: resumeText, truncated } = truncateResumeText(
    rawResume || "(No resume text extracted.)",
  );

  return [
    "Score this candidate against the job. Return JSON only.",
    "",
    "## Job",
    `Title: ${params.job.title}`,
    `Description:\n${params.job.description}`,
    `Required skills: ${(params.job.skills ?? []).join(", ") || "(none listed)"}`,
    `Experience range (years): ${params.job.experienceMin}${
      params.job.experienceMax != null ? `–${params.job.experienceMax}` : "+"
    }`,
    `Must-have criteria: ${(criteria.mustHave ?? []).join("; ") || "(none)"}`,
    `Nice-to-have criteria: ${(criteria.niceToHave ?? []).join("; ") || "(none)"}`,
    "",
    "## Candidate",
    `Name: ${params.candidate.firstName} ${params.candidate.lastName}`,
    `Summary: ${params.candidate.summary ?? "(none)"}`,
    `Skills: ${(params.candidate.skills ?? []).join(", ") || "(none)"}`,
    `Years of experience: ${params.candidate.experience}`,
    `Education JSON: ${JSON.stringify(params.candidate.education ?? [])}`,
    `Certifications JSON: ${JSON.stringify(params.candidate.certifications ?? [])}`,
    truncated
      ? "Resume text was truncated (kept first 4000 + last 2000 characters)."
      : "Resume text is complete (not truncated).",
    `Resume text:\n${resumeText}`,
    "",
    "JSON schema keys:",
    '{ "overall": 0-100, "breakdown": { "technicalSkills", "experience", "education", "domainExperience", "jobRequirements" }, "whyMatch": string[3-6], "missingRequirements": string[], "concerns": string[], "recommendedAction": "SHORTLIST"|"REVIEW"|"REJECT", "reasoning": string }',
  ].join("\n");
}

/**
 * Run advisory JD↔resume screening via local Ollama.
 * Throws AIError on failure — callers must not store unvalidated output.
 */
export async function runResumeScreening(params: {
  job: Pick<
    Job,
    | "title"
    | "description"
    | "skills"
    | "experienceMin"
    | "experienceMax"
    | "screeningCriteria"
  >;
  candidate: ScreeningCandidateInput;
}): Promise<{ result: ScreeningResult; model: string; raw: unknown }> {
  const user = buildScreeningUserPrompt(params);

  try {
    const { data, model, raw } = await chatJSON(
      SYSTEM_PROMPT,
      user,
      ScreeningResultSchema,
    );

    if (!data.reasoning?.trim()) {
      throw new AIError(
        "VALIDATION",
        "Screening result missing mandatory reasoning",
      );
    }

    return { result: data, model, raw };
  } catch (err) {
    if (err instanceof AIError) throw err;
    throw new AIError(
      "VALIDATION",
      err instanceof Error ? err.message : "Screening failed",
      err,
    );
  }
}
