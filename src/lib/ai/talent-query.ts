import { z } from "zod";
import { AIError, chatJSON } from "@/lib/ai/ollama";

export const TalentQuerySchema = z.object({
  semanticText: z.string(),
  skills: z.array(z.string()),
  minExperience: z.number().nullable(),
  maxExperience: z.number().nullable(),
  minInterviewScore: z.number().min(0).max(100).nullable(),
  minScreeningScore: z.number().min(0).max(100).nullable(),
  tags: z.array(z.string()),
  location: z.string().nullable(),
});

export type TalentQuery = z.infer<typeof TalentQuerySchema>;

const TALENT_QUERY_JSON_SCHEMA = `{
  "semanticText": string,
  "skills": string[],
  "minExperience": number|null,
  "maxExperience": number|null,
  "minInterviewScore": number|null,
  "minScreeningScore": number|null,
  "tags": string[],
  "location": string|null
}`;

const SYSTEM = `You parse recruiter talent-pool search queries into structured filters for a hiring ATS.

Extract ONLY what the user explicitly stated. Never invent skills, scores, locations, tags, or experience bounds. Unstated numeric fields must be null; unstated arrays must be [].

Field meanings:
- semanticText: the role / skill essence of the query to embed for similarity search (always a non-empty string derived from the query).
- skills: explicit skill or tool names mentioned (e.g. React, Figma, PostgreSQL).
- minExperience / maxExperience: years of experience bounds if stated (e.g. "5+ years" → minExperience 5, maxExperience null).
- minInterviewScore: 0-100 threshold if they mention interview scores (maps to INTERVIEW_OVERALL).
- minScreeningScore: 0-100 threshold if they mention screening / resume scores (maps to RESUME_SCREEN).
- tags: only if they refer to org tags by name.
- location: location string if stated, else null.

Return ONLY valid JSON matching this exact schema:
${TALENT_QUERY_JSON_SCHEMA}`;

function fallbackQuery(q: string): TalentQuery {
  return {
    semanticText: q.trim() || q,
    skills: [],
    minExperience: null,
    maxExperience: null,
    minInterviewScore: null,
    minScreeningScore: null,
    tags: [],
    location: null,
  };
}

/**
 * Parse a natural-language talent query into structured filters.
 * On AIError → semantic-only fallback with parsed:false (never throws for LLM failures).
 */
export async function parseTalentQuery(
  q: string,
): Promise<{ query: TalentQuery; parsed: boolean; model?: string }> {
  const trimmed = q.trim();
  if (!trimmed) {
    return { query: fallbackQuery(""), parsed: false };
  }

  try {
    const { data, model } = await chatJSON(
      SYSTEM,
      `Recruiter query:\n${trimmed}`,
      TalentQuerySchema,
      { temperature: 0.1 },
    );
    const semanticText = data.semanticText.trim() || trimmed;
    return {
      query: { ...data, semanticText },
      parsed: true,
      model,
    };
  } catch (err) {
    if (err instanceof AIError) {
      console.warn(
        "[talent-query] parse failed, semantic-only fallback:",
        err.message,
      );
      return { query: fallbackQuery(trimmed), parsed: false };
    }
    throw err;
  }
}

/** Human-readable chip labels for the Understood: row. */
export function talentFilterChips(q: TalentQuery): Array<{
  key: keyof TalentQuery | "skillsItem" | "tagsItem";
  label: string;
  /** Index into skills/tags when key is skillsItem/tagsItem */
  index?: number;
}> {
  const chips: Array<{
    key: keyof TalentQuery | "skillsItem" | "tagsItem";
    label: string;
    index?: number;
  }> = [];

  q.skills.forEach((s, i) => {
    chips.push({ key: "skillsItem", label: s, index: i });
  });
  if (q.minExperience != null) {
    chips.push({
      key: "minExperience",
      label: `${q.minExperience}+ yrs`,
    });
  }
  if (q.maxExperience != null) {
    chips.push({
      key: "maxExperience",
      label: `≤ ${q.maxExperience} yrs`,
    });
  }
  if (q.minInterviewScore != null) {
    chips.push({
      key: "minInterviewScore",
      label: `interview ≥ ${q.minInterviewScore}`,
    });
  }
  if (q.minScreeningScore != null) {
    chips.push({
      key: "minScreeningScore",
      label: `screening ≥ ${q.minScreeningScore}`,
    });
  }
  if (q.location) {
    chips.push({ key: "location", label: q.location });
  }
  q.tags.forEach((t, i) => {
    chips.push({ key: "tagsItem", label: `tag:${t}`, index: i });
  });

  return chips;
}

/** Remove one chip from a TalentQuery (used by UI re-search). */
export function removeTalentFilterChip(
  q: TalentQuery,
  chip: { key: string; index?: number },
): TalentQuery {
  const next = { ...q, skills: [...q.skills], tags: [...q.tags] };
  switch (chip.key) {
    case "skillsItem":
      if (chip.index != null) next.skills.splice(chip.index, 1);
      break;
    case "tagsItem":
      if (chip.index != null) next.tags.splice(chip.index, 1);
      break;
    case "minExperience":
      next.minExperience = null;
      break;
    case "maxExperience":
      next.maxExperience = null;
      break;
    case "minInterviewScore":
      next.minInterviewScore = null;
      break;
    case "minScreeningScore":
      next.minScreeningScore = null;
      break;
    case "location":
      next.location = null;
      break;
    default:
      break;
  }
  return next;
}
