import { Prisma, type PrismaClient } from "@prisma/client";
import { HISTORICAL_JOB_DESCRIPTION, RESUME_PARSER_SOURCE } from "./constants";
import { ImportFileError } from "./file";
import {
  normalizeRows,
  roleKey,
  validateMapping,
  type ColumnMap,
  type ImportMapping,
  type ImportRow,
  type RowError,
} from "./mapping";

type Db = PrismaClient | Prisma.TransactionClient;

const CHUNK = 1000;
const TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

export type ImportReport = {
  applied: boolean;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: RowError[];
  duplicatesInFile: number;
  duplicatesExisting: number;
  candidatesNew: number;
  candidatesExisting: number;
  applicationsNew: number;
  jobsNew: number;
  jobsNewTitles: string[];
  missingDates: number;
  blankExperience: number;
  unmappedColumns: string[];
};

type Plan = {
  apps: { row: ImportRow; candidateId: string | null; jobId: string | null }[];
  newCandidates: Map<string, ImportRow>;
  existingCandidateIds: Set<string>;
  newJobs: Map<string, string>;
  duplicatesExisting: number;
};

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

async function buildPlan(db: Db, organizationId: string, rows: ImportRow[]): Promise<Plan> {
  const candidateByEmail = await candidatesByEmail(db, organizationId, Array.from(new Set(rows.map((r) => r.email))));

  const jobs = await db.job.findMany({
    where: { organizationId },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const jobByRole = new Map<string, string>();
  for (const j of jobs) {
    const key = roleKey(j.title);
    if (!jobByRole.has(key)) jobByRole.set(key, j.id);
  }

  const existingPairs = new Set<string>();
  const knownCandidateIds = Array.from(new Set(candidateByEmail.values()));
  for (const part of chunks(knownCandidateIds)) {
    const found = await db.application.findMany({
      where: { candidateId: { in: part } },
      select: { candidateId: true, jobId: true },
    });
    for (const a of found) existingPairs.add(`${a.candidateId}|${a.jobId}`);
  }

  const importedIds = new Set<string>();
  if (rows.some((r) => r.externalId)) {
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
  }

  const plan: Plan = {
    apps: [],
    newCandidates: new Map(),
    existingCandidateIds: new Set(),
    newJobs: new Map(),
    duplicatesExisting: 0,
  };
  for (const row of rows) {
    if (row.externalId && importedIds.has(row.externalId)) {
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
  args: { organizationId: string; userId: string; plan: Plan; now: Date; beforeApplications?: () => Promise<void> },
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

  await args.beforeApplications?.();

  const resolved = plan.apps.map((a) => {
    const candidateId = a.candidateId ?? candidateIdByEmail.get(a.row.email);
    const jobId = a.jobId ?? jobIdByRole.get(a.row.roleKey);
    if (!candidateId || !jobId) throw new Error("resume_parser_import_unresolved_row");
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
        const payload: Record<string, string | boolean> = {
          source: RESUME_PARSER_SOURCE,
          appliedAtKnown: row.appliedAt !== null,
        };
        if (row.externalId) payload.resumeParserId = row.externalId;
        if (row.resumeReference) payload.resumeReference = row.resumeReference;
        return {
          applicationId: app.id,
          type: "APPLICATION_CREATED" as const,
          payload,
          createdAt: row.appliedAt ?? now,
        };
      }),
    });
  }

  return { candidatesNew, applicationsNew, duplicatesAtWrite };
}

/**
 * Validates a Resume Parser export against HR's column mapping and, when `apply` is set,
 * writes it in one transaction: either every valid row is saved or nothing is.
 * Existing candidates are never modified; they only gain applications. Imported applications
 * are APPLIED + ON_HOLD with source "resume_parser". Bulk queries only (no query per row).
 */
export async function runResumeParserImport(args: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  header: string[];
  rows: string[][];
  mapping: ImportMapping;
  apply: boolean;
  now?: Date;
  /** Test hook: runs inside the transaction after candidates are written. */
  beforeApplications?: () => Promise<void>;
}): Promise<ImportReport> {
  const now = args.now ?? new Date();
  const problems = validateMapping(args.mapping.columns as ColumnMap, args.header);
  if (problems.length > 0) throw new ImportFileError(problems.join(" "));

  const normalized = normalizeRows(args.header, args.rows, args.mapping, now);
  const base = {
    totalRows: normalized.totalRows,
    validRows: normalized.rows.length,
    errorRows: normalized.errorCount,
    errors: normalized.errors,
    duplicatesInFile: normalized.duplicatesInFile,
    missingDates: normalized.missingDates,
    blankExperience: normalized.blankExperience,
    unmappedColumns: normalized.unmappedColumns,
  };

  if (!args.apply) {
    const plan = await buildPlan(args.prisma, args.organizationId, normalized.rows);
    return {
      ...base,
      applied: false,
      duplicatesExisting: plan.duplicatesExisting,
      candidatesNew: plan.newCandidates.size,
      candidatesExisting: plan.existingCandidateIds.size,
      applicationsNew: plan.apps.length,
      jobsNew: plan.newJobs.size,
      jobsNewTitles: Array.from(plan.newJobs.values()).slice(0, 50),
    };
  }

  return args.prisma.$transaction(
    async (tx) => {
      const lockKey = `resume_parser_import:${args.organizationId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
      const plan = await buildPlan(tx, args.organizationId, normalized.rows);
      const written = await writePlan(tx, {
        organizationId: args.organizationId,
        userId: args.userId,
        plan,
        now,
        beforeApplications: args.beforeApplications,
      });
      return {
        ...base,
        applied: true,
        duplicatesExisting: plan.duplicatesExisting + written.duplicatesAtWrite,
        candidatesNew: written.candidatesNew,
        candidatesExisting: plan.existingCandidateIds.size,
        applicationsNew: written.applicationsNew,
        jobsNew: plan.newJobs.size,
        jobsNewTitles: Array.from(plan.newJobs.values()).slice(0, 50),
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 15_000 },
  );
}
