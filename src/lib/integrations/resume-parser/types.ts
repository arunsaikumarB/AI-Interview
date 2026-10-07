import { z } from "zod";

/**
 * One historical Resume Parser application (role + date) for `importResumeParserRecords`. The
 * Resume Parser API does not provide this shape; it serves profiles (`resumeParserProfileSchema`).
 * External data is untrusted: every record is validated before it reaches the database.
 */
export const resumeParserRecordSchema = z
  .object({
    /** Stable Resume Parser application ID. Required: it is what prevents duplicates. */
    externalId: z.string().trim().min(1).max(100),
    fullName: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.string().trim().max(40).optional(),
    /** Role the person applied for (historical; never matched to a current opening). */
    jobRole: z.string().trim().min(1).max(200),
    experienceYears: z.number().min(0).max(60).optional(),
    /** ISO date (YYYY-MM-DD or full ISO timestamp). */
    appliedAt: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}/)
      .optional(),
  })
  .strict();

export type ResumeParserRecord = z.output<typeof resumeParserRecordSchema>;

const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim().slice(0, max));

/**
 * One profile from `GET /api/v1/external/profiles/search/`. Untrusted: lengths are capped and
 * `resume_url` is ignored (downloads are built from the configured server address and the id).
 */
export const resumeParserProfileSchema = z.object({
  id: z.number().int().positive(),
  name: text(160),
  email: text(254),
  phone_numbers: text(120),
  location: text(120),
  region: text(120),
  linkedin: text(300),
  total_experience: z.number().min(0).max(80).nullish().transform((v) => v ?? null),
  skills: z.array(z.string().trim().min(1).max(80)).max(200).catch([]),
  matched_skills: z.array(z.string().trim().min(1).max(80)).max(200).catch([]),
  created_at: text(40),
  file_name: text(255),
});

export type ResumeParserProfile = z.output<typeof resumeParserProfileSchema>;

export const resumeParserSearchResponseSchema = z.object({
  count: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1).max(100),
  total_pages: z.number().int().min(0),
  results: z.array(resumeParserProfileSchema).max(100),
});

/** Filters as the Resume Parser API defines them; every filter is AND-ed. */
export type ResumeParserSearch = {
  skills?: string[];
  anySkills?: string[];
  excludeSkills?: string[];
  minExperience?: number;
  maxExperience?: number;
  city?: string;
  state?: string;
};

export type ResumeParserPage = {
  profiles: ResumeParserProfile[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ResumeParserResumeFile = { fileName: string | null; mimeType: string; data: Buffer };
