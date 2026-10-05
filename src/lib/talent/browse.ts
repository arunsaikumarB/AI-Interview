import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { RESUME_PARSER_SOURCE } from "@/lib/integrations/resume-parser/constants";
import { isUntouchedImport } from "@/lib/hiring/pipeline-filter";

export const TALENT_PAGE_SIZE = 25;

export const TALENT_SOURCES = ["careers_site", "resume_parser", "resume_upload", "added_by_staff", "no_application"] as const;
export type TalentSource = (typeof TALENT_SOURCES)[number];

export const TALENT_SOURCE_LABELS: Record<TalentSource, string> = {
  careers_site: "Careers",
  resume_parser: "Resume Parser",
  resume_upload: "Uploaded resume",
  added_by_staff: "Added by staff",
  no_application: "Uploaded, no job",
};

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const num = (schema: z.ZodNumber) => z.preprocess(blankToUndefined, z.coerce.number().pipe(schema).optional());

export const talentFiltersSchema = z
  .object({
    q: text(100),
    role: text(200),
    minExp: num(z.number().min(0).max(60)),
    maxExp: num(z.number().min(0).max(60)),
    year: num(z.number().int().min(1990).max(2100)),
    month: num(z.number().int().min(1).max(12)),
    skills: text(300),
    source: z.preprocess(blankToUndefined, z.enum(TALENT_SOURCES).optional()),
    hiring: z.preprocess(blankToUndefined, z.enum(["all", "in_hiring", "not_in_hiring"]).default("all")),
    page: z.preprocess(blankToUndefined, z.coerce.number().pipe(z.number().int().min(1).max(10_000)).default(1)),
  })
  .strict()
  .refine((f) => f.month === undefined || f.year !== undefined, { message: "Choose a year before a month.", path: ["month"] })
  .refine((f) => f.minExp === undefined || f.maxExp === undefined || f.minExp <= f.maxExp, {
    message: "Minimum experience is more than maximum.",
    path: ["minExp"],
  });

export type TalentFilters = z.output<typeof talentFiltersSchema>;

export type TalentRow = {
  id: string;
  name: string;
  email: string;
  experience: number;
  skills: string[];
  location: string | null;
  hasResume: boolean;
  /** Open HireOS hiring process, if any. */
  inHiring: { applicationId: string; jobTitle: string; stage: string } | null;
  /** Most recent applications, newest first (historical included). */
  applications: { jobTitle: string; jobClosed: boolean; appliedAt: string; source: string | null }[];
  sources: string[];
  addedAt: string;
};

export type TalentPage = { rows: TalentRow[]; total: number; page: number; pageSize: number; pageCount: number };

const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const contains = (s: string) => `%${likeEscape(s)}%`;

/** Same rule as ACTIVE_PIPELINE_FILTER, for raw SQL over Application alias `a`. */
const ACTIVE_APP_SQL = Prisma.sql`(a.source IS DISTINCT FROM ${RESUME_PARSER_SOURCE} OR a.status <> 'ON_HOLD' OR a.stage <> 'APPLIED')`;
const OPEN_PROCESS_SQL = Prisma.sql`(${ACTIVE_APP_SQL} AND a.status IN ('ACTIVE', 'ON_HOLD') AND a.stage NOT IN ('SELECTED', 'REJECTED'))`;

function dateRange(f: TalentFilters): { from: Date; to: Date } | null {
  if (f.year === undefined) return null;
  if (f.month === undefined) return { from: new Date(Date.UTC(f.year, 0, 1)), to: new Date(Date.UTC(f.year + 1, 0, 1)) };
  return { from: new Date(Date.UTC(f.year, f.month - 1, 1)), to: new Date(Date.UTC(f.year, f.month, 1)) };
}

/**
 * WHERE clause for one organization. Every filter is AND-ed. Role, date and source must all
 * match the SAME application. Without an application, a profile's date is when it was added.
 */
export function talentWhere(organizationId: string, f: TalentFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`c."organizationId" = ${organizationId}`];

  const tokens = (f.q ?? "").split(/\s+/).filter(Boolean).slice(0, 5);
  for (const t of tokens) {
    const p = contains(t);
    parts.push(Prisma.sql`(c."firstName" ILIKE ${p} OR c."lastName" ILIKE ${p} OR c.email ILIKE ${p})`);
  }
  if (f.minExp !== undefined) parts.push(Prisma.sql`c.experience >= ${f.minExp}`);
  if (f.maxExp !== undefined) parts.push(Prisma.sql`c.experience <= ${f.maxExp}`);

  const skills = (f.skills ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  for (const s of skills) {
    parts.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(c.skills) AS sk(v) WHERE lower(sk.v) LIKE ${contains(s)})`);
  }

  const range = dateRange(f);
  const noApp = Prisma.sql`NOT EXISTS (SELECT 1 FROM "Application" a WHERE a."candidateId" = c.id)`;
  const addedInRange = range ? Prisma.sql`c."createdAt" >= ${range.from} AND c."createdAt" < ${range.to}` : Prisma.sql`TRUE`;

  if (f.source === "no_application") {
    parts.push(f.role ? Prisma.sql`FALSE` : Prisma.sql`(${noApp} AND ${addedInRange})`);
  } else if (f.role || range || f.source) {
    const appParts: Prisma.Sql[] = [Prisma.sql`a."candidateId" = c.id`, Prisma.sql`j."organizationId" = ${organizationId}`];
    if (f.role) appParts.push(Prisma.sql`j.title ILIKE ${contains(f.role)}`);
    if (range) appParts.push(Prisma.sql`a."createdAt" >= ${range.from} AND a."createdAt" < ${range.to}`);
    if (f.source) appParts.push(Prisma.sql`a.source = ${f.source}`);
    const appMatch = Prisma.sql`EXISTS (SELECT 1 FROM "Application" a JOIN "Job" j ON j.id = a."jobId" WHERE ${Prisma.join(appParts, " AND ")})`;
    parts.push(!f.role && !f.source ? Prisma.sql`(${appMatch} OR (${noApp} AND ${addedInRange}))` : appMatch);
  }

  const openProcess = Prisma.sql`EXISTS (SELECT 1 FROM "Application" a WHERE a."candidateId" = c.id AND ${OPEN_PROCESS_SQL})`;
  if (f.hiring === "in_hiring") parts.push(openProcess);
  if (f.hiring === "not_in_hiring") parts.push(Prisma.sql`NOT ${openProcess}`);

  return Prisma.join(parts, " AND ");
}

function isOpenProcess(a: { source: string | null; status: string; stage: string }): boolean {
  return !isUntouchedImport(a) && (a.status === "ACTIVE" || a.status === "ON_HOLD") && a.stage !== "SELECTED" && a.stage !== "REJECTED";
}

/** One page of talent for an organization. Only the page's rows leave the database. */
export async function browseTalent(db: PrismaClient, organizationId: string, f: TalentFilters): Promise<TalentPage> {
  const where = talentWhere(organizationId, f);
  const [{ n }] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Candidate" c WHERE ${where}`;
  const pageCount = Math.max(1, Math.ceil(n / TALENT_PAGE_SIZE));
  const page = Math.min(f.page, pageCount);
  const ids =
    n === 0
      ? []
      : await db.$queryRaw<{ id: string }[]>`
          SELECT c.id FROM "Candidate" c WHERE ${where}
          ORDER BY c."createdAt" DESC, c.id DESC
          LIMIT ${TALENT_PAGE_SIZE} OFFSET ${(page - 1) * TALENT_PAGE_SIZE}`;

  const found = await db.candidate.findMany({
    where: { id: { in: ids.map((r) => r.id) }, organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      experience: true,
      skills: true,
      location: true,
      resumeUrl: true,
      createdAt: true,
      applications: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, source: true, status: true, stage: true, createdAt: true, job: { select: { title: true, status: true } } },
      },
    },
  });
  const byId = new Map(found.map((c) => [c.id, c]));

  const rows = ids.flatMap(({ id }): TalentRow[] => {
    const c = byId.get(id);
    if (!c) return [];
    const open = c.applications.find(isOpenProcess);
    const sources = Array.from(new Set(c.applications.map((a) => a.source ?? "other")));
    return [
      {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        email: c.email,
        experience: c.experience,
        skills: c.skills.slice(0, 8),
        location: c.location,
        hasResume: Boolean(c.resumeUrl),
        inHiring: open ? { applicationId: open.id, jobTitle: open.job.title, stage: open.stage } : null,
        applications: c.applications.slice(0, 3).map((a) => ({
          jobTitle: a.job.title,
          jobClosed: a.job.status === "CLOSED",
          appliedAt: a.createdAt.toISOString(),
          source: a.source,
        })),
        sources: sources.length > 0 ? sources : ["no_application"],
        addedAt: c.createdAt.toISOString(),
      },
    ];
  });

  return { rows, total: n, page, pageSize: TALENT_PAGE_SIZE, pageCount };
}
