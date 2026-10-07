import { Prisma, type PrismaClient } from "@prisma/client";
import { checkUploadedResume, resumeMimeType } from "@/lib/resume-import";
import { deleteStoredFile, saveUpload } from "@/lib/storage";
import { RESUME_UPLOAD_SOURCE, rowWarnings, type UploadRow } from "./constants";
import { extractResumeFields, type ResumeFields } from "./extract";
import { extractResumeProfile, type ResumeProfile } from "./profile";
import { recallOcrText, rememberOcrText } from "./text-cache";
import { stripPageMarkers } from "@/lib/resume/text";

type Db = PrismaClient | Prisma.TransactionClient;

export type ProfileJobInput = { candidateId: string; organizationId: string; experienceSet: boolean };

export type UploadDeps = {
  extractText: (p: { buffer: Buffer; mimeType: string; fileName: string }) => Promise<string>;
  embed: (candidateId: string) => Promise<unknown>;
  /** Background AI reading of new candidates' resumes (fills empty profile fields). */
  queueProfile?: (jobs: ProfileJobInput[]) => Promise<void>;
};

/** What saving would do: new candidate, link an existing one to the job, or nothing. */
export type PlanStatus = "new" | "link" | "exists" | "already_applied";

/** What else was read from the resume, shown in the review table. */
export type ProfileSummary = {
  skills: number;
  education: number;
  certifications: number;
  location: string;
  linkedIn: boolean;
  summary: boolean;
};

export type ReadResult =
  | { name: string; status: "invalid"; reason: string }
  | {
      name: string;
      status: PlanStatus;
      parsed: boolean;
      fields: ResumeFields;
      profile: ProfileSummary;
      /** Scanned, or the PDF's text layer looks damaged: worth an OCR pass. */
      needsOcr: boolean;
      ocr?: boolean;
    };

export type SaveResult = {
  name: string;
  status: "created" | "linked" | "exists" | "already_applied" | "invalid" | "failed";
  parsed?: boolean;
  reason?: string;
};

/** Profile values from a trusted source that win over what was read from the file. */
export type ProfileOverrides = Partial<Pick<ResumeProfile, "location" | "linkedIn" | "skills">>;

const EMPTY_PROFILE: ResumeProfile = {
  location: "",
  linkedIn: "",
  summary: "",
  skills: [],
  education: [],
  certifications: [],
  experienceYears: null,
};

function summarize(p: ResumeProfile): ProfileSummary {
  return {
    skills: p.skills.length,
    education: p.education.length,
    certifications: p.certifications.length,
    location: p.location,
    linkedIn: Boolean(p.linkedIn),
    summary: Boolean(p.summary),
  };
}

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

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

async function readText(extractText: UploadDeps["extractText"], name: string, buffer: Buffer): Promise<string | null> {
  try {
    const text = await extractText({
      buffer,
      mimeType: resumeMimeType(name) ?? "application/octet-stream",
      fileName: name,
    });
    return stripPageMarkers(text) || null;
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
  const profile = text ? extractResumeProfile(text) : EMPTY_PROFILE;
  const { status } = await planFor(db, organizationId, fields.email, jobId);
  const needsOcr = isPdf(name) && (!text || rowWarnings(fields).length > 0);
  return { name, status, parsed: Boolean(text), fields, profile: summarize(profile), needsOcr };
}

/** Prefer the PDF's own value; use the OCR value when the PDF's is missing or looks cut off. */
function mergeFields(pdf: ResumeFields, ocr: ResumeFields): ResumeFields {
  const pdfWarn = rowWarnings(pdf);
  return {
    firstName: pdf.firstName || ocr.firstName,
    lastName: pdf.firstName ? pdf.lastName : ocr.lastName,
    email: !pdf.email || pdfWarn.includes("email looks cut off") ? ocr.email || pdf.email : pdf.email,
    phone: !pdf.phone || pdfWarn.includes("phone looks incomplete") ? ocr.phone || pdf.phone : pdf.phone,
    experience: pdf.experience ?? ocr.experience,
  };
}

/**
 * Read-only OCR pass for one scanned or damaged PDF. The OCR text is remembered
 * briefly so Save stores it without running OCR again.
 */
export async function ocrUploadedResume(
  db: Db,
  args: {
    organizationId: string;
    jobId: string | null;
    name: string;
    type: string;
    buffer: Buffer;
    deps: Pick<UploadDeps, "extractText"> & { ocr: (buffer: Buffer) => Promise<string> };
  },
): Promise<ReadResult> {
  const { organizationId, jobId, name, buffer } = args;
  const problem = checkUploadedResume(name, args.type, buffer);
  if (problem) return { name, status: "invalid", reason: problem };
  if (!isPdf(name)) return { name, status: "invalid", reason: "only PDF files can be scanned" };
  const pdfText = await readText(args.deps.extractText, name, buffer);
  const ocrText = stripPageMarkers(await args.deps.ocr(buffer).catch(() => ""));
  if (ocrText) rememberOcrText(organizationId, buffer, ocrText);
  const pdfFields = extractResumeFields(pdfText ?? "", name);
  const fields = ocrText ? mergeFields(pdfFields, extractResumeFields(ocrText, name)) : pdfFields;
  const best = ocrText || pdfText;
  const profile = best ? extractResumeProfile(best) : EMPTY_PROFILE;
  const { status } = await planFor(db, organizationId, fields.email, jobId);
  return { name, status, parsed: Boolean(best), fields, profile: summarize(profile), needsOcr: false, ocr: Boolean(ocrText) };
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
  args: {
    organizationId: string;
    jobId: string | null;
    row: UploadRow;
    type: string;
    buffer: Buffer;
    deps: UploadDeps;
    overrides?: ProfileOverrides;
    /** Saved with a new candidate, in the same transaction. */
    note?: { authorId: string; text: string };
  },
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

  const resumeText = recallOcrText(organizationId, buffer) ?? (await readText(deps.extractText, name, buffer));
  const read = resumeText ? extractResumeProfile(resumeText) : EMPTY_PROFILE;
  const o = args.overrides ?? {};
  const profile: ResumeProfile = {
    ...read,
    location: o.location || read.location,
    linkedIn: o.linkedIn || read.linkedIn,
    skills: o.skills && o.skills.length > 0 ? o.skills : read.skills,
  };
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
          ...(profile.location ? { location: profile.location } : {}),
          ...(profile.linkedIn ? { linkedIn: profile.linkedIn } : {}),
          ...(profile.summary ? { summary: profile.summary } : {}),
          ...(profile.skills.length > 0 ? { skills: profile.skills } : {}),
          ...(profile.education.length > 0 ? { education: profile.education } : {}),
          ...(profile.certifications.length > 0 ? { certifications: profile.certifications } : {}),
        },
        select: { id: true },
      });
      if (args.note) {
        await tx.note.create({ data: { candidateId: candidate.id, authorId: args.note.authorId, text: args.note.text } });
      }
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
  if (deps.queueProfile) {
    try {
      await deps.queueProfile([{ candidateId, organizationId, experienceSet: row.experience !== null }]);
    } catch (err) {
      console.error("[upload-resumes] could not queue background reading", {
        name: err instanceof Error ? err.name : typeof err,
      });
    }
  }
  return { name, status: "created", parsed: Boolean(resumeText) };
}
