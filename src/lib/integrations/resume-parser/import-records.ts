import { Prisma, type PrismaClient } from "@prisma/client";
import { HISTORICAL_JOB_DESCRIPTION, RESUME_PARSER_SOURCE } from "./constants";
import { resumeParserRecordSchema } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

const CHUNK = 1000;
const TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;
const EARLIEST_YEAR = 1990;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RecordImportReport = {
  applied: boolean;
  received: number;
  invalidRecords: number;
  duplicatesInBatch: number;
  duplicatesExisting: number;
  candidatesNew: number;
  candidatesExisting: number;
  applicationsNew: number;
  jobsNew: number;
};

type Row = {
  externalId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  jobRole: string;
  roleKey: string;
  experience: number;
  appliedAt: Date | null;
};

type Plan = {
  apps: { row: Row; candidateId: string | null; jobId: string | null }[];
  newCandidates: Map<string, Row>;
  existingCandidateIds: Set<string>;
  newJobs: Map<string, string>;
  duplicatesExisting: number;
};

/** Lowercased, single-spaced title used to match a role to a job. */
function roleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Calendar date at 12:00 UTC so it is the same day in IST and UTC. Undefined = unknown. */
function appliedDate(raw: string | undefined, now: Date): Date | null | "invalid" {
  if (!raw) return null;
  const [y, m, d] = raw.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (y < EARLIEST_YEAR || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "invalid";
  if (date.getTime() > now.getTime() + DAY_MS) return "invalid";
  return date;
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Candidate ids by lowercased email. Emails must already be lowercased. */
async function candidatesByEmail(db: Db, organizationId: string, emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(emails)) {
    const found = await db.$queryRaw<{ id: string; email: string }[]>`
      SELECT id, email FROM "Candidate"
      WHERE "organizationId" = ${organizationId} AND lower(email) = ANY(${part}::text[])`;
    for (const c of found) out.set(c.email.toLowerCase(), c.id);
  }
  return out;
}

async function buildPlan(db: Db, organizationId: string, rows: Row[]): Promise<Plan> {
  const candidateByEmail = await candidatesByEmail(db, organizationId, Array.from(new Set(rows.map((r) => r.email))));

  // History never lands on a current opening: Add to Hiring creates that application separately.
  const jobs = await db.job.findMany({
    where: { organizationId, status: "CLOSED" },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const jobByRole = new Map<string, string>();
  for (const j of jobs) {
    const key = roleKey(j.title);
    if (!jobByRole.has(key)) jobByRole.set(key, j.id);
  }

  const existingPairs = new Set<string>();
  for (const part of chunks(Array.from(new Set(candidateByEmail.values())))) {
    const found = await db.application.findMany({
      where: { candidateId: { in: part } },
      select: { candidateId: true, jobId: true },
    });
    for (const a of found) existingPairs.add(`${a.candidateId}|${a.jobId}`);
  }

  const importedIds = new Set<string>();
  const found = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT t.payload->>'resumeParserId' AS id
    FROM "TimelineEvent" t
    JOIN "Application" a ON a.id = t."applicationId"
    JOIN "Job" j ON j.id = a."jobId"
    WHERE j."organizationId" = ${organizationId}
      AND a.source = ${RESUME_PARSER_SOURCE}
      AND t.type = 'APPLICATION_CREATED'
      AND t.payload->>'resumeParserId' IS NOT NULL`;
  for (const r of found) importedIds.add(r.id);

  const plan: Plan = {
    apps: [],
    newCandidates: new Map(),
    existingCandidateIds: new Set(),
    newJobs: new Map(),
    duplicatesExisting: 0,
  };
  for (const row of rows) {
    if (importedIds.has(row.externalId)) {
      plan.duplicatesExisting++;
      continue;
    }
    const candidateId = candidateByEmail.get(row.email) ?? null;
    const jobId = jobByRole.get(row.roleKey) ?? null;
    if (candidateId && jobId && existingPairs.has(`${candidateId}|${jobId}`)) {
      plan.duplicatesExisting++;
      continue;
    }
    plan.apps.push({ row, candidateId, jobId });
    if (candidateId) {
      plan.existingCandidateIds.add(candidateId);
    } else {
      const prev = plan.newCandidates.get(row.email);
      if (!prev || (row.appliedAt?.getTime() ?? 0) > (prev.appliedAt?.getTime() ?? 0)) {
        plan.newCandidates.set(row.email, row);
      }
    }
    if (!jobId && !plan.newJobs.has(row.roleKey)) plan.newJobs.set(row.roleKey, row.jobRole);
  }
  return plan;
}

async function writePlan(
  tx: Prisma.TransactionClient,
  args: { organizationId: string; userId: string; plan: Plan; now: Date },
): Promise<{ candidatesNew: number; applicationsNew: number; duplicatesAtWrite: number }> {
  const { organizationId, userId, plan, now } = args;

  const jobIdByRole = new Map<string, string>();
  if (plan.newJobs.size > 0) {
    const created = await tx.job.createManyAndReturn({
      data: Array.from(plan.newJobs.values()).map((title) => ({
        organizationId,
        title,
        description: HISTORICAL_JOB_DESCRIPTION,
        status: "CLOSED" as const,
        createdById: userId,
        skills: [],
        screeningCriteria: {},
        interviewStages: [],
      })),
      select: { id: true, title: true },
    });
    for (const j of created) jobIdByRole.set(roleKey(j.title), j.id);
  }

  let candidatesNew = 0;
  const newRows = Array.from(plan.newCandidates.values());
  for (const part of chunks(newRows)) {
    const res = await tx.candidate.createMany({
      data: part.map((r) => ({
        organizationId,
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        phone: r.phone,
        experience: r.experience,
        createdAt: r.appliedAt ?? now,
        updatedAt: r.appliedAt ?? now,
      })),
      skipDuplicates: true,
    });
    candidatesNew += res.count;
  }
  const candidateIdByEmail = await candidatesByEmail(tx, organizationId, newRows.map((r) => r.email));

  const resolved = plan.apps.map((a) => {
    const candidateId = a.candidateId ?? candidateIdByEmail.get(a.row.email);
    const jobId = a.jobId ?? jobIdByRole.get(a.row.roleKey);
    if (!candidateId || !jobId) throw new Error("resume_parser_record_unresolved");
    return { row: a.row, candidateId, jobId };
  });

  let applicationsNew = 0;
  let duplicatesAtWrite = 0;
  for (const part of chunks(resolved)) {
    const created = await tx.application.createManyAndReturn({
      data: part.map((a) => ({
        candidateId: a.candidateId,
        jobId: a.jobId,
        stage: "APPLIED" as const,
        status: "ON_HOLD" as const,
        source: RESUME_PARSER_SOURCE,
        createdAt: a.row.appliedAt ?? now,
        updatedAt: a.row.appliedAt ?? now,
      })),
      skipDuplicates: true,
      select: { id: true, candidateId: true, jobId: true },
    });
    applicationsNew += created.length;
    duplicatesAtWrite += part.length - created.length;

    const rowByPair = new Map(part.map((a) => [`${a.candidateId}|${a.jobId}`, a.row]));
    await tx.timelineEvent.createMany({
      data: created.map((app) => {
        const row = rowByPair.get(`${app.candidateId}|${app.jobId}`)!;
        return {
          applicationId: app.id,
          type: "APPLICATION_CREATED" as const,
          payload: { source: RESUME_PARSER_SOURCE, appliedAtKnown: row.appliedAt !== null, resumeParserId: row.externalId },
          createdAt: row.appliedAt ?? now,
        };
      }),
    });
  }

  return { candidatesNew, applicationsNew, duplicatesAtWrite };
}

/**
 * Brings Resume Parser records into the Talent Pool: one candidate per email (existing candidates
 * are never modified, they only gain history), history on a Closed job with the same title
 * (created when missing) as Applied + On hold, duplicates skipped by Resume Parser ID. Nothing
 * enters active hiring and no AI runs. Invalid records are counted and skipped, never written.
 * With `apply` the batch is written in one transaction, serialized per organization.
 */
export async function importResumeParserRecords(args: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  records: unknown[];
  apply: boolean;
  now?: Date;
}): Promise<RecordImportReport> {
  const now = args.now ?? new Date();
  let invalidRecords = 0;
  let duplicatesInBatch = 0;
  const rows: Row[] = [];
  const seenIds = new Set<string>();
  const seenEmailRole = new Set<string>();
  for (const raw of args.records) {
    const parsed = resumeParserRecordSchema.safeParse(raw);
    const appliedAt = parsed.success ? appliedDate(parsed.data.appliedAt, now) : "invalid";
    if (!parsed.success || appliedAt === "invalid") {
      invalidRecords++;
      continue;
    }
    const r = parsed.data;
    const jobRole = r.jobRole.replace(/\s+/g, " ");
    const key = roleKey(jobRole);
    if (seenIds.has(r.externalId) || seenEmailRole.has(`${r.email}|${key}`)) {
      duplicatesInBatch++;
      continue;
    }
    seenIds.add(r.externalId);
    seenEmailRole.add(`${r.email}|${key}`);
    const names = r.fullName.split(/\s+/).filter(Boolean);
    rows.push({
      externalId: r.externalId,
      email: r.email,
      firstName: names[0] ?? "",
      lastName: names.slice(1).join(" "),
      phone: r.phone || null,
      jobRole,
      roleKey: key,
      experience: Math.round((r.experienceYears ?? 0) * 100) / 100,
      appliedAt,
    });
  }

  const base = { received: args.records.length, invalidRecords, duplicatesInBatch };

  if (!args.apply) {
    const plan = await buildPlan(args.prisma, args.organizationId, rows);
    return {
      ...base,
      applied: false,
      duplicatesExisting: plan.duplicatesExisting,
      candidatesNew: plan.newCandidates.size,
      candidatesExisting: plan.existingCandidateIds.size,
      applicationsNew: plan.apps.length,
      jobsNew: plan.newJobs.size,
    };
  }

  return args.prisma.$transaction(
    async (tx) => {
      const lockKey = `resume_parser_import:${args.organizationId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
      const plan = await buildPlan(tx, args.organizationId, rows);
      const written = await writePlan(tx, { organizationId: args.organizationId, userId: args.userId, plan, now });
      return {
        ...base,
        applied: true,
        duplicatesExisting: plan.duplicatesExisting + written.duplicatesAtWrite,
        candidatesNew: written.candidatesNew,
        candidatesExisting: plan.existingCandidateIds.size,
        applicationsNew: written.applicationsNew,
        jobsNew: plan.newJobs.size,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 15_000 },
  );
}
