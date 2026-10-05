import type { PrismaClient } from "@prisma/client";
import { runResumeParserImport, type ImportReport } from "@/lib/resume-parser-import/importer";
import type { ImportMapping } from "@/lib/resume-parser-import/mapping";
import { resumeParserRecordSchema } from "./types";

const HEADER = ["externalId", "fullName", "email", "phone", "jobRole", "experience", "appliedAt", "resumeReference"];
const MAPPING: ImportMapping = {
  columns: { externalId: 0, fullName: 1, email: 2, phone: 3, jobRole: 4, experience: 5, appliedAt: 6, resumeReference: 7 },
  dateFormat: "YMD",
};

export type RecordImportReport = ImportReport & { invalidRecords: number };

/**
 * Brings Resume Parser records into the Talent Pool through the same writer as the CSV import:
 * one candidate per email, history on Closed jobs (Applied + On hold), duplicates skipped by
 * Resume Parser ID. Nothing enters active hiring and no AI runs. Records that fail validation
 * are counted and skipped, never written.
 */
export async function importResumeParserRecords(args: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  records: unknown[];
  apply: boolean;
  now?: Date;
}): Promise<RecordImportReport> {
  let invalidRecords = 0;
  const rows: string[][] = [];
  for (const raw of args.records) {
    const parsed = resumeParserRecordSchema.safeParse(raw);
    if (!parsed.success) {
      invalidRecords++;
      continue;
    }
    const r = parsed.data;
    rows.push([
      r.externalId,
      r.fullName,
      r.email,
      r.phone ?? "",
      r.jobRole,
      r.experienceYears === undefined ? "" : String(r.experienceYears),
      r.appliedAt ? r.appliedAt.slice(0, 10) : "",
      r.resumeFileName ?? "",
    ]);
  }
  const report = await runResumeParserImport({
    prisma: args.prisma,
    organizationId: args.organizationId,
    userId: args.userId,
    header: HEADER,
    rows,
    mapping: MAPPING,
    apply: args.apply,
    now: args.now,
  });
  return { ...report, invalidRecords };
}
