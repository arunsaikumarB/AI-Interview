/**
 * Operator import of job listings from the company careers website export
 * (docs/careers-website-jobs.json shape). Used by scripts/import-jobs.ts.
 *
 * Every imported job is created as DRAFT so HR reviews it before it is open
 * for applications. Existing jobs are never changed: a listing whose title
 * already exists in the organization is skipped.
 */
import { z } from "zod";
import type { EmploymentType, Prisma, PrismaClient } from "@prisma/client";

export const JOB_IMPORT_MAX = 500;
export const JOB_IMPORT_FILE_MAX_BYTES = 2 * 1024 * 1024;

export class JobImportError extends Error {}

const line = z.string().trim().min(1).max(1000);

const listingSchema = z.object({
  jobId: z.string().trim().max(100).optional(),
  title: z.string().trim().min(2).max(200),
  location: z.string().trim().max(120).optional(),
  workType: z.string().trim().max(60).optional(),
  experience: z.string().trim().max(40).optional(),
  duration: z.string().trim().max(40).optional(),
  department: z.string().trim().max(120).optional(),
  positions: z.number().int().min(1).max(1000).optional(),
  summary: z.string().trim().min(10).max(5000),
  responsibilities: z.array(line).max(50).optional(),
  requirements: z.array(line).max(50).optional(),
  whyJoinUs: z.array(line).max(50).optional(),
});

export type CareersListing = z.infer<typeof listingSchema>;

/** "2+ yrs" -> 2..open, "0-1 Years" -> 0..1, empty -> 0..open. null = not understood. */
export function parseExperience(text: string | undefined): { min: number; max: number | null } | null {
  const s = (text ?? "").trim();
  if (!s) return { min: 0, max: null };
  const plus = /^(\d{1,2})\s*\+/.exec(s);
  if (plus) return { min: Number(plus[1]), max: null };
  const range = /^(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/i.exec(s);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return max >= min ? { min, max } : null;
  }
  return null;
}

const EMPLOYMENT_TYPES: Record<string, EmploymentType> = {
  fulltime: "FULL_TIME",
  parttime: "PART_TIME",
  contract: "CONTRACT",
  intern: "INTERN",
  internship: "INTERN",
  temporary: "TEMPORARY",
};

/** "Full time" -> FULL_TIME; empty -> FULL_TIME; null = not understood. */
export function parseEmploymentType(text: string | undefined): EmploymentType | null {
  const key = (text ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return "FULL_TIME";
  return EMPLOYMENT_TYPES[key] ?? null;
}

export function buildDescription(listing: CareersListing): string {
  const parts = [listing.summary];
  const section = (heading: string, items: string[] | undefined) => {
    if (items?.length) parts.push(`${heading}\n${items.map((i) => `- ${i}`).join("\n")}`);
  };
  section("Responsibilities", listing.responsibilities);
  section("Requirements", listing.requirements);
  section("Why join us", listing.whyJoinUs);
  if (listing.jobId) parts.push(`Careers website reference: ${listing.jobId}`);
  return parts.join("\n\n");
}

export function buildLocation(listing: CareersListing): string | null {
  const value = [listing.location, listing.workType].filter((v) => v && v.length).join(" · ");
  return value || null;
}

export type JobDraft = {
  title: string;
  description: string;
  location: string | null;
  experienceMin: number;
  experienceMax: number | null;
  employmentType: EmploymentType;
  openings: number;
  departmentId: string | null;
};

export type PlannedJob = {
  index: number;
  draft: JobDraft;
  departmentName: string | null;
  departmentFound: boolean;
};

export type SkippedJob = { index: number; title: string; reasons: string[] };

export type JobImportPlan = { ready: PlannedJob[]; skipped: SkippedJob[] };

export function parseListingsJson(text: string): unknown[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new JobImportError("The file is not valid JSON.");
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { jobs?: unknown }).jobs)
      ? (data as { jobs: unknown[] }).jobs
      : null;
  if (!list) throw new JobImportError("Expected a JSON array of jobs (or { \"jobs\": [...] }).");
  if (list.length === 0) throw new JobImportError("The file contains no jobs.");
  if (list.length > JOB_IMPORT_MAX) throw new JobImportError(`The file has more than ${JOB_IMPORT_MAX} jobs.`);
  return list;
}

const titleKey = (title: string) => title.trim().toLowerCase();

/** Read-only: validates every listing and decides what would be created. */
export async function planJobImport(args: {
  prisma: PrismaClient;
  organizationId: string;
  jsonText: string;
}): Promise<JobImportPlan> {
  const { prisma, organizationId } = args;
  const raw = parseListingsJson(args.jsonText);

  const [existingJobs, departments] = await Promise.all([
    prisma.job.findMany({ where: { organizationId }, select: { title: true } }),
    prisma.department.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);
  const existingTitles = new Set(existingJobs.map((j) => titleKey(j.title)));
  const departmentByName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const seenInFile = new Set<string>();

  const plan: JobImportPlan = { ready: [], skipped: [] };
  raw.forEach((item, i) => {
    const index = i + 1;
    const parsed = listingSchema.safeParse(item);
    if (!parsed.success) {
      const title =
        item && typeof item === "object" && typeof (item as { title?: unknown }).title === "string"
          ? String((item as { title: string }).title).slice(0, 200)
          : "";
      plan.skipped.push({
        index,
        title,
        reasons: parsed.error.issues.map((iss) => `${iss.path.join(".") || "job"}: ${iss.message}`),
      });
      return;
    }
    const listing = parsed.data;
    const reasons: string[] = [];
    const experience = parseExperience(listing.experience);
    if (!experience) reasons.push(`experience "${listing.experience}" not understood (use e.g. "2+ yrs" or "0-1 Years")`);
    const employmentType = parseEmploymentType(listing.duration);
    if (!employmentType) reasons.push(`duration "${listing.duration}" not understood (use e.g. "Full time")`);
    const key = titleKey(listing.title);
    if (existingTitles.has(key)) reasons.push("a job with this title already exists (not changed)");
    else if (seenInFile.has(key)) reasons.push("duplicate title in the file");
    seenInFile.add(key);

    if (reasons.length || !experience || !employmentType) {
      plan.skipped.push({ index, title: listing.title, reasons });
      return;
    }

    const departmentName = listing.department ?? null;
    const departmentId = departmentName ? departmentByName.get(departmentName.toLowerCase()) ?? null : null;
    plan.ready.push({
      index,
      departmentName,
      departmentFound: Boolean(departmentId),
      draft: {
        title: listing.title,
        description: buildDescription(listing),
        location: buildLocation(listing),
        experienceMin: experience.min,
        experienceMax: experience.max,
        employmentType,
        openings: listing.positions ?? 1,
        departmentId,
      },
    });
  });
  return plan;
}

export type JobImportResult = { status: "CREATED"; jobId: string } | { status: "SKIPPED"; reason: string };

/** Creates one planned job as DRAFT. Re-checks the title so a concurrent create is not duplicated. */
export async function importJob(args: {
  prisma: PrismaClient;
  organizationId: string;
  createdById: string;
  job: PlannedJob;
}): Promise<JobImportResult> {
  const { prisma, organizationId, createdById, job } = args;
  const existing = await prisma.job.findFirst({
    where: { organizationId, title: { equals: job.draft.title, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return { status: "SKIPPED", reason: "a job with this title already exists (not changed)" };

  const data: Prisma.JobUncheckedCreateInput = {
    ...job.draft,
    organizationId,
    createdById,
    status: "DRAFT",
    skills: [],
    screeningCriteria: {},
    interviewStages: [],
  };
  const created = await prisma.job.create({ data, select: { id: true } });
  return { status: "CREATED", jobId: created.id };
}
