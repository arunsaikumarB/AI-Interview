import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { contentMatchesExtension, isPlainFileName } from "@/lib/resume-import";
import { isAllowedResumeFile, RESUME_MAX_BYTES } from "@/lib/resume/mime";
import { deleteStoredFile, saveUpload } from "@/lib/storage";
import { RESUME_PARSER_SOURCE } from "./constants";

export {
  RESUME_BATCH_MAX_BYTES,
  RESUME_BATCH_MAX_FILES,
  RESUME_SELECTION_MAX_FILES,
} from "./constants";

type Db = PrismaClient | Prisma.TransactionClient;

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

/** Lowercased file name of a resume reference: "C:\cv\Ravi.pdf" or "https://x/files/Ravi.pdf?v=2" → "ravi.pdf". */
export function resumeKey(ref: string): string {
  const noQuery = ref.trim().split(/[?#]/)[0] ?? "";
  const base = noQuery.split(/[\\/]/).pop() ?? "";
  return base.trim().toLowerCase();
}

export type ResumeMatchStatus = "ready" | "no_match" | "ambiguous" | "has_resume";
export type ResumeAttachStatus = ResumeMatchStatus | "attached" | "invalid" | "failed";

type Target = { key: string; candidateId: string; applicationId: string; hasResume: boolean };

/**
 * Imported Resume Parser applications in this organization whose resume reference has one
 * of these file names. One row per (file name, candidate), earliest application first.
 */
async function findTargets(db: Db, organizationId: string, keys: string[]): Promise<Map<string, Target[]>> {
  const out = new Map<string, Target[]>();
  if (keys.length === 0) return out;
  const rows = await db.$queryRaw<Target[]>`
    SELECT DISTINCT ON (k.key, a."candidateId")
      k.key, a."candidateId" AS "candidateId", a.id AS "applicationId", (c."resumeUrl" IS NOT NULL) AS "hasResume"
    FROM "TimelineEvent" t
    JOIN "Application" a ON a.id = t."applicationId"
    JOIN "Job" j ON j.id = a."jobId"
    JOIN "Candidate" c ON c.id = a."candidateId"
    CROSS JOIN LATERAL (
      SELECT lower(trim(regexp_replace(split_part(split_part(t.payload->>'resumeReference', '?', 1), '#', 1), '^.*[\\\\/]', ''))) AS key
    ) k
    WHERE j."organizationId" = ${organizationId}
      AND c."organizationId" = ${organizationId}
      AND a.source = ${RESUME_PARSER_SOURCE}
      AND t.type = 'APPLICATION_CREATED'
      AND t.payload->>'resumeReference' IS NOT NULL
      AND k.key = ANY(${keys}::text[])
    ORDER BY k.key, a."candidateId", a."createdAt" ASC`;
  for (const r of rows) {
    const list = out.get(r.key) ?? [];
    list.push(r);
    out.set(r.key, list);
  }
  return out;
}

function statusOf(targets: Target[] | undefined): { status: ResumeMatchStatus; target?: Target } {
  if (!targets || targets.length === 0) return { status: "no_match" };
  if (targets.length > 1) return { status: "ambiguous" };
  if (targets[0].hasResume) return { status: "has_resume" };
  return { status: "ready", target: targets[0] };
}

/** Read-only: what would happen to each file name. */
export async function matchResumeNames(
  db: Db,
  organizationId: string,
  names: string[],
): Promise<{ name: string; status: ResumeMatchStatus }[]> {
  const targets = await findTargets(db, organizationId, Array.from(new Set(names.map(resumeKey))));
  return names.map((name) => ({ name, status: statusOf(targets.get(resumeKey(name))).status }));
}

export type AttachDeps = {
  extractText: (p: { buffer: Buffer; mimeType: string; fileName: string }) => Promise<string>;
  embed: (candidateId: string) => Promise<unknown>;
};

export type AttachResult = { name: string; status: ResumeAttachStatus; parsed?: boolean; reason?: string };

function checkFile(name: string, type: string, buffer: Buffer): string | null {
  if (!isPlainFileName(name) || name.length > 255) return "file name is not allowed";
  if (!isAllowedResumeFile({ name, type })) return "must be PDF, DOCX or TXT";
  if (buffer.length === 0) return "file is empty";
  if (buffer.length > RESUME_MAX_BYTES) return "file is larger than 10 MB";
  const ext = path.extname(name).toLowerCase();
  if (!contentMatchesExtension(ext, buffer)) return `file content is not a real ${ext.slice(1).toUpperCase()}`;
  return null;
}

/**
 * Attaches one resume file to the imported candidate whose Resume Parser row named it.
 * Only fills an empty resume; a candidate who already has one is left unchanged.
 * Text is extracted locally; a file whose text cannot be read is still stored.
 */
export async function attachResumeFile(
  db: PrismaClient,
  args: { organizationId: string; name: string; type: string; buffer: Buffer; deps: AttachDeps },
): Promise<AttachResult> {
  const { organizationId, name, buffer, deps } = args;
  const problem = checkFile(name, args.type, buffer);
  if (problem) return { name, status: "invalid", reason: problem };

  const key = resumeKey(name);
  const { status, target } = statusOf((await findTargets(db, organizationId, [key])).get(key));
  if (status !== "ready" || !target) return { name, status };

  const mimeType = MIME_BY_EXT[path.extname(name).toLowerCase()];
  let resumeText: string | null = null;
  try {
    resumeText = (await deps.extractText({ buffer, mimeType, fileName: name })) || null;
  } catch {
    resumeText = null;
  }

  const stored = await saveUpload({ category: "resumes", originalName: name, data: buffer });
  let updated: boolean;
  try {
    updated = await db.$transaction(async (tx) => {
      const res = await tx.candidate.updateMany({
        where: { id: target.candidateId, organizationId, resumeUrl: null },
        data: { resumeUrl: stored.relativePath, ...(resumeText ? { resumeText } : {}) },
      });
      if (res.count === 0) return false;
      await tx.timelineEvent.create({
        data: {
          applicationId: target.applicationId,
          type: "DOCUMENT_UPLOADED",
          payload: { fileName: stored.fileName, parsed: Boolean(resumeText), source: RESUME_PARSER_SOURCE },
        },
      });
      return true;
    });
  } catch (err) {
    await deleteStoredFile(stored.relativePath).catch(() => undefined);
    throw err;
  }
  if (!updated) {
    await deleteStoredFile(stored.relativePath).catch(() => undefined);
    return { name, status: "has_resume" };
  }

  if (resumeText) {
    try {
      await deps.embed(target.candidateId);
    } catch {
      // Search embedding can be rebuilt later (npm run embed:backfill); the resume is saved.
    }
  }
  return { name, status: "attached", parsed: Boolean(resumeText) };
}
