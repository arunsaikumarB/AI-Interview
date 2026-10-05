import { z } from "zod";

/**
 * One Resume Parser application as HireOS needs it. PROVISIONAL: the Resume Parser API has not
 * been provided, so these are HireOS field names, not Resume Parser's. When the API spec
 * arrives, map its payload onto this shape in the client; nothing downstream should change.
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
    /** Resume file name in Resume Parser, used to attach the PDF later. */
    resumeFileName: z.string().trim().max(500).optional(),
  })
  .strict();

export type ResumeParserRecord = z.output<typeof resumeParserRecordSchema>;

export type ResumeParserSearch = {
  name?: string;
  email?: string;
  role?: string;
  minExperience?: number;
  year?: number;
  month?: number;
};

export type ResumeParserPage = { records: ResumeParserRecord[]; total: number; page: number; pageSize: number };

export type ResumeParserResumeFile = { fileName: string; mimeType: string; data: Buffer };
