import { Prisma, type PrismaClient } from "@prisma/client";
import { checkUploadedResume, resumeMimeType } from "@/lib/resume-import";
import { deleteStoredFile, saveUpload } from "@/lib/storage";
import { RESUME_UPLOAD_SOURCE, type UploadRow } from "./constants";
import { extractResumeFields, type ResumeFields } from "./extract";

type Db = PrismaClient | Prisma.TransactionClient;

export type UploadDeps = {
  extractText: (p: { buffer: Buffer; mimeType: string; fileName: string }) => Promise<string>;
  embed: (candidateId: string) => Promise<unknown>;
};

/** What saving would do: new candidate, link an existing one to the job, or nothing. */
export type PlanStatus = "new" | "link" | "exists" | "already_applied";

export type ReadResult =
  | { name: string; status: "invalid"; reason: string }
  | { name: string; status: PlanStatus; parsed: boolean; fields: ResumeFields };

export type SaveResult = {
  name: string;
  status: "created" | "linked" | "exists" | "already_applied" | "invalid" | "failed";
  parsed?: boolean;
  reason?: string;
};

async function findCandidateId(db: Db, organizationId: string, email: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Candidate"
    WHERE "organizationId" = ${organizationId} AND lower(email) = ${email.toLowerCase()}
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

async function planFor(
  db: Db,
  organizationId: string,
  email: string,
  jobId: string | null,
): Promise<{ status: PlanStatus; candidateId: string | null }> {
  const candidateId = email ? await findCandidateId(db, organizationId, email) : null;
  if (!candidateId) return { status: "new", candidateId: null };
  if (!jobId) return { status: "exists", candidateId };
  const applied = await db.application.findUnique({
    where: { candidateId_jobId: { candidateId, jobId } },
    select: { id: true },
  });
  return { status: applied ? "already_applied" : "link", candidateId };
}

/** The PDF reader adds "-- 1 of 2 --" page markers; a scanned PDF yields nothing else. */
const PAGE_MARKER = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm;

async function readText(extractText: UploadDeps["extractText"], name: string, buffer: Buffer): Promise<string | null> {
  try {
    const text = await extractText({
      buffer,
      mimeType: resumeMimeType(name) ?? "application/octet-stream",
      fileName: name,
    });
    const clean = text.replace(PAGE_MARKER, "").replace(/\n{3,}/g, "\n\n").trim();
    return clean || null;
  } catch {
    return null;
  }
}

/** Read-only: checks the file, reads its text locally and suggests the candidate's details. */
export async function readUploadedResume(
  db: Db,
  args: { organizationId: string; jobId: string | null; name: string; type: string; buffer: Buffer; deps: Pick<UploadDeps, "extractText"> },
): Promise<ReadResult> {
  const { organizationId, jobId, name, buffer } = args;
  const problem = checkUploadedResume(name, args.type, buffer);
  if (problem) return { name, status: "invalid", reason: problem };
  const text = await readText(args.deps.extractText, name, buffer);
  const fields = extractResumeFields(text ?? "", name);
  const { status } = await planFor(db, organizationId, fields.email, jobId);
  return { name, status, parsed: Boolean(text), fields };
}

class DuplicateEmail extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof DuplicateEmail || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002");
}

/**
 * Saves one reviewed resume. A new email creates the candidate (and an application at
 * Applied when a job is chosen). An existing candidate is never changed; with a job it
 * only gains an application to that job.
 */
export async function saveUploadedResume(
  db: PrismaClient,
  args: { organizationId: string; jobId: string | null; row: UploadRow; type: string; buffer: Buffer; deps: UploadDeps },
): Promise<SaveResult> {
  const { organizationId, jobId, row, buffer, deps } = args;
  const name = row.fileName;
  const problem = checkUploadedResume(name, args.type, buffer);
  if (problem) return { name, status: "invalid", reason: problem };

  const plan = await planFor(db, organizationId, row.email, jobId);
  if (plan.status === "exists" || plan.status === "already_applied") return { name, status: plan.status };

  if (plan.status === "link" && plan.candidateId && jobId) {
    try {
      await db.application.create({
        data: {
          jobId,
          candidateId: plan.candidateId,
          stage: "APPLIED",
          status: "ACTIVE",
          source: RESUME_UPLOAD_SOURCE,
          timelineEvents: {
            create: { type: "APPLICATION_CREATED", payload: { source: RESUME_UPLOAD_SOURCE, existingCandidate: true } },
          },
        },
        select: { id: true },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { name, status: "already_applied" };
      throw err;
    }
    return { name, status: "linked" };
  }

  const resumeText = await readText(deps.extractText, name, buffer);
  const stored = await saveUpload({ category: "resumes", originalName: name, data: buffer });
  let candidateId: string;
  try {
    candidateId = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`resume-upload:${organizationId}:${row.email}`}))::text`;
      if (await findCandidateId(tx, organizationId, row.email)) throw new DuplicateEmail();
      const candidate = await tx.candidate.create({
        data: {
          organizationId,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone || null,
          ...(row.experience !== null ? { experience: row.experience } : {}),
          resumeUrl: stored.relativePath,
          ...(resumeText ? { resumeText } : {}),
        },
        select: { id: true },
      });
      if (jobId) {
        await tx.application.create({
          data: {
            jobId,
            candidateId: candidate.id,
            stage: "APPLIED",
            status: "ACTIVE",
            source: RESUME_UPLOAD_SOURCE,
            timelineEvents: {
              create: [
                { type: "APPLICATION_CREATED", payload: { source: RESUME_UPLOAD_SOURCE } },
                {
                  type: "DOCUMENT_UPLOADED",
                  payload: { fileName: stored.fileName, parsed: Boolean(resumeText), source: RESUME_UPLOAD_SOURCE },
                },
              ],
            },
          },
          select: { id: true },
        });
      }
      return candidate.id;
    });
  } catch (err) {
    await deleteStoredFile(stored.relativePath).catch(() => undefined);
    if (isUniqueViolation(err)) {
      return { name, status: "exists", reason: "this email was added by someone else at the same time" };
    }
    throw err;
  }

  if (resumeText) {
    try {
      await deps.embed(candidateId);
    } catch {
      // Search embedding can be rebuilt later (npm run embed:backfill); the candidate is saved.
    }
  }
  return { name, status: "created", parsed: Boolean(resumeText) };
}
