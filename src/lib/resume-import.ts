/**
 * Operator bulk import of existing resumes (folder of files + CSV manifest).
 * Used by scripts/import-resumes.ts. Each row goes through the same steps as a
 * careers-site application: file checks, local text extraction, Candidate,
 * optional Application at APPLIED with a timeline event, then embedding.
 *
 * Never overwrites an existing candidate: a row whose email already exists in
 * the organization only gains a new application (if a job is given).
 */
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Prisma, type JobStatus, type PrismaClient } from "@prisma/client";
import { isAllowedResumeFile, RESUME_MAX_BYTES } from "@/lib/resume/mime";
import { deleteStoredFile, saveUpload } from "@/lib/storage";

export const IMPORT_SOURCE = "bulk_import";
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_CSV_MAX_BYTES = 5 * 1024 * 1024;

export class ImportError extends Error {}

const COLUMNS = ["file", "firstName", "lastName", "email", "phone", "location", "job"] as const;
type Column = (typeof COLUMNS)[number];
const REQUIRED_COLUMNS: Column[] = ["file", "firstName", "lastName", "email"];

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

/** RFC 4180 CSV: quoted fields, doubled quotes, commas/newlines inside quotes, CRLF, UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endRow = () => {
    row.push(field);
    field = "";
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new ImportError("The CSV has an unclosed quote.");
  endRow();
  return rows;
}

export type CsvRow = { rowNumber: number; values: Partial<Record<Column, string>> };

/** Maps header names case-insensitively (spaces/underscores ignored) onto the known columns. */
export function readManifest(text: string): { rows: CsvRow[]; ignoredColumns: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new ImportError("The CSV is empty.");

  const key = (h: string) => h.trim().toLowerCase().replace(/[\s_-]/g, "");
  const index = new Map<Column, number>();
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    const col = COLUMNS.find((c) => c.toLowerCase() === key(h));
    if (col && !index.has(col)) index.set(col, i);
    else if (h.trim()) ignoredColumns.push(h.trim());
  });

  const missing = REQUIRED_COLUMNS.filter((c) => !index.has(c));
  if (missing.length) {
    throw new ImportError(`The CSV is missing required column(s): ${missing.join(", ")}.`);
  }
  if (body.length > IMPORT_MAX_ROWS) {
    throw new ImportError(`The CSV has ${body.length} rows; the limit is ${IMPORT_MAX_ROWS} per run.`);
  }

  const rows = body.map((cells, i) => {
    const values: Partial<Record<Column, string>> = {};
    index.forEach((at, col) => {
      values[col] = cells[at] ?? "";
    });
    return { rowNumber: i + 2, values };
  });
  return { rows, ignoredColumns };
}

const rowSchema = z.object({
  file: z.string().min(1, "file is required").max(255),
  firstName: z.string().min(1, "firstName is required").max(80),
  lastName: z.string().min(1, "lastName is required").max(80),
  email: z.string().email("email is not valid").max(200),
  phone: z.string().max(40).optional(),
  location: z.string().max(120).optional(),
  job: z.string().max(200).optional(),
});

export type ImportRowData = z.infer<typeof rowSchema>;

export function validateRow(
  values: CsvRow["values"],
): { ok: true; data: ImportRowData } | { ok: false; problems: string[] } {
  const clean = (v: string | undefined) => {
    const t = (v ?? "").trim();
    return t === "" ? undefined : t;
  };
  const parsed = rowSchema.safeParse({
    file: clean(values.file) ?? "",
    firstName: clean(values.firstName) ?? "",
    lastName: clean(values.lastName) ?? "",
    email: (clean(values.email) ?? "").toLowerCase(),
    phone: clean(values.phone),
    location: clean(values.location),
    job: clean(values.job),
  });
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`),
  };
}

/** A manifest file name must be a plain name inside the resume folder (no paths). */
export function isPlainFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    path.basename(name) === name
  );
}

function contentMatchesExtension(ext: string, buf: Buffer): boolean {
  if (ext === ".pdf") return buf.subarray(0, 5).toString("latin1") === "%PDF-";
  if (ext === ".docx") {
    return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  }
  return !buf.subarray(0, 4096).includes(0);
}

export type LoadedResume = { buffer: Buffer; mimeType: string; fileName: string };

export async function loadResumeFile(
  dir: string,
  fileName: string,
): Promise<{ ok: true; resume: LoadedResume } | { ok: false; problem: string }> {
  if (!isPlainFileName(fileName)) {
    return { ok: false, problem: "file must be a plain file name inside the resume folder" };
  }
  const root = path.resolve(dir);
  const abs = path.resolve(root, fileName);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, problem: "file must be inside the resume folder" };
  }

  const ext = path.extname(fileName).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType || !isAllowedResumeFile({ name: fileName, type: mimeType })) {
    return { ok: false, problem: "resume must be PDF, DOCX or TXT" };
  }

  let info;
  try {
    info = await lstat(abs);
  } catch {
    return { ok: false, problem: "file not found in the resume folder" };
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    return { ok: false, problem: "file is not a regular file" };
  }
  if (info.size === 0) return { ok: false, problem: "file is empty" };
  if (info.size > RESUME_MAX_BYTES) return { ok: false, problem: "file is larger than 10 MB" };

  const buffer = await readFile(abs);
  if (!contentMatchesExtension(ext, buffer)) {
    return { ok: false, problem: `file content is not a real ${ext.slice(1).toUpperCase()}` };
  }
  return { ok: true, resume: { buffer, mimeType, fileName } };
}

export type ImportJob = { id: string; title: string; status: JobStatus };

/** Matches a job by id, or by exact title (case-insensitive) when that title is unique. */
export function resolveJob(
  jobs: ImportJob[],
  ref: string,
): { ok: true; job: ImportJob } | { ok: false; problem: string } {
  const byId = jobs.find((j) => j.id === ref);
  if (byId) return { ok: true, job: byId };
  const wanted = ref.trim().toLowerCase();
  const byTitle = jobs.filter((j) => j.title.trim().toLowerCase() === wanted);
  if (byTitle.length === 1) return { ok: true, job: byTitle[0]! };
  if (byTitle.length > 1) {
    return { ok: false, problem: `job "${ref}" matches ${byTitle.length} jobs; use the job id instead` };
  }
  return { ok: false, problem: `job "${ref}" was not found in this organization` };
}

export type PlannedAction = "NEW_CANDIDATE" | "NEW_CANDIDATE_AND_APPLICATION" | "APPLICATION_FOR_EXISTING";

export type PlannedRow = {
  rowNumber: number;
  data: ImportRowData;
  job: ImportJob | null;
  action: PlannedAction;
};

export type SkippedRow = { rowNumber: number; file: string; reasons: string[] };

export type ImportPlan = {
  ready: PlannedRow[];
  skipped: SkippedRow[];
  ignoredColumns: string[];
};

/** Read-only: validates every row, file, job and existing record. Writes nothing. */
export async function planImport(params: {
  prisma: PrismaClient;
  organizationId: string;
  dir: string;
  csvText: string;
}): Promise<ImportPlan> {
  const { prisma, organizationId, dir } = params;
  const { rows, ignoredColumns } = readManifest(params.csvText);
  const jobs = await prisma.job.findMany({
    where: { organizationId },
    select: { id: true, title: true, status: true },
  });

  const ready: PlannedRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();
  const newEmails = new Set<string>();

  for (const row of rows) {
    const file = (row.values.file ?? "").trim();
    const valid = validateRow(row.values);
    if (!valid.ok) {
      skipped.push({ rowNumber: row.rowNumber, file, reasons: valid.problems });
      continue;
    }
    const data = valid.data;
    const reasons: string[] = [];

    let job: ImportJob | null = null;
    if (data.job) {
      const resolved = resolveJob(jobs, data.job);
      if (resolved.ok) job = resolved.job;
      else reasons.push(resolved.problem);
    }

    const dupKey = `${data.email}|${job?.id ?? ""}`;
    if (seen.has(dupKey)) reasons.push("duplicate of an earlier row (same email and job)");

    const candidate = await prisma.candidate.findUnique({
      where: { organizationId_email: { organizationId, email: data.email } },
      select: { id: true },
    });
    const exists = Boolean(candidate) || newEmails.has(data.email);

    if (exists && !job) reasons.push("candidate already exists and no job was given");
    if (candidate && job) {
      const applied = await prisma.application.findUnique({
        where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
        select: { id: true },
      });
      if (applied) reasons.push("candidate has already applied to this job");
    }

    if (!exists) {
      const loaded = await loadResumeFile(dir, data.file);
      if (!loaded.ok) reasons.push(loaded.problem);
    }

    if (reasons.length) {
      skipped.push({ rowNumber: row.rowNumber, file: data.file, reasons });
      continue;
    }
    seen.add(dupKey);
    if (!exists) newEmails.add(data.email);
    ready.push({
      rowNumber: row.rowNumber,
      data,
      job,
      action: exists
        ? "APPLICATION_FOR_EXISTING"
        : job
          ? "NEW_CANDIDATE_AND_APPLICATION"
          : "NEW_CANDIDATE",
    });
  }

  return { ready, skipped, ignoredColumns };
}

export type ImportDeps = {
  extractText: (p: { buffer: Buffer; mimeType: string; fileName: string }) => Promise<string>;
  embed: (candidateId: string) => Promise<{ updated: boolean }>;
};

export type RowResult =
  | {
      status: "CREATED";
      candidateId: string;
      applicationId: string | null;
      parsed: boolean;
      embedded: boolean;
    }
  | { status: "APPLICATION_ADDED"; candidateId: string; applicationId: string }
  | { status: "SKIPPED"; reason: string };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Writes one planned row. Re-checks existing records so a re-run never duplicates or overwrites. */
export async function importRow(params: {
  prisma: PrismaClient;
  organizationId: string;
  dir: string;
  row: PlannedRow;
  deps: ImportDeps;
}): Promise<RowResult> {
  const { prisma, organizationId, dir, row, deps } = params;
  const { data, job } = row;

  const existing = await prisma.candidate.findUnique({
    where: { organizationId_email: { organizationId, email: data.email } },
    select: { id: true },
  });

  if (existing) {
    if (!job) return { status: "SKIPPED", reason: "candidate already exists and no job was given" };
    try {
      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: existing.id,
          stage: "APPLIED",
          status: "ACTIVE",
          source: IMPORT_SOURCE,
          timelineEvents: {
            create: {
              type: "APPLICATION_CREATED",
              payload: { source: IMPORT_SOURCE, existingCandidate: true },
            },
          },
        },
        select: { id: true },
      });
      return { status: "APPLICATION_ADDED", candidateId: existing.id, applicationId: application.id };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { status: "SKIPPED", reason: "candidate has already applied to this job" };
      }
      throw err;
    }
  }

  const loaded = await loadResumeFile(dir, data.file);
  if (!loaded.ok) return { status: "SKIPPED", reason: loaded.problem };
  const { buffer, mimeType } = loaded.resume;

  let resumeText: string | null = null;
  let parseError: string | null = null;
  try {
    resumeText = (await deps.extractText({ buffer, mimeType, fileName: data.file })) || null;
  } catch (err) {
    parseError = err instanceof Error ? err.message : "Parse failed";
  }

  const stored = await saveUpload({ category: "resumes", originalName: data.file, data: buffer });

  let created: { candidateId: string; applicationId: string | null };
  try {
    created = await prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({
        data: {
          organizationId,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          location: data.location,
          resumeUrl: stored.relativePath,
          ...(resumeText ? { resumeText } : {}),
        },
        select: { id: true },
      });
      if (!job) return { candidateId: candidate.id, applicationId: null };
      const application = await tx.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          stage: "APPLIED",
          status: "ACTIVE",
          source: IMPORT_SOURCE,
          timelineEvents: {
            create: {
              type: "APPLICATION_CREATED",
              payload: { source: IMPORT_SOURCE, parsed: Boolean(resumeText), parseError },
            },
          },
        },
        select: { id: true },
      });
      return { candidateId: candidate.id, applicationId: application.id };
    });
  } catch (err) {
    await deleteStoredFile(stored.relativePath).catch(() => undefined);
    if (isUniqueViolation(err)) {
      return { status: "SKIPPED", reason: "candidate was created by someone else during the import" };
    }
    throw err;
  }

  let embedded = false;
  if (resumeText) {
    try {
      embedded = (await deps.embed(created.candidateId)).updated;
    } catch {
      embedded = false;
    }
  }

  return {
    status: "CREATED",
    candidateId: created.candidateId,
    applicationId: created.applicationId,
    parsed: Boolean(resumeText),
    embedded,
  };
}
