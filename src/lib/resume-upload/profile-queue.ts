import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { AiProfile } from "./ai-profile";
import { extractResumeProfile, type ResumeProfile } from "./profile";

/**
 * Background resume reading, one candidate at a time: OCR when the stored resume
 * has no text, then local AI fills profile fields that are still empty.
 *
 * - Advisory data only. Never touches name, email, phone, applications or stages.
 * - Fill-empty: a field that already has a value (rule-based, HR or AI) is never changed.
 * - Bounded: R-3 attempt limit, transient errors only; failures are recorded honestly.
 * - Waits while any live interview is running so it never slows the interview AI.
 * - Gives way to foreground AI (screening etc.): a cancelled call is re-queued without
 *   using an attempt, and the worker waits until foreground AI has been quiet.
 * - The queue is a small JSON file under the private storage root (survives restarts).
 */

export const MAX_PROFILE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60_000;
const LIVE_INTERVIEW_WAIT_MS = 30_000;
const FOREGROUND_WAIT_MS = 15_000;
const PREEMPTED_DELAY_MS = 30_000;
const KEEP_DONE_MS = 7 * 24 * 3600_000;
const KEEP_FAILED_MS = 30 * 24 * 3600_000;

export type ProfileJobStatus = "pending" | "running" | "done" | "failed";

export type ProfileJob = {
  candidateId: string;
  organizationId: string;
  status: ProfileJobStatus;
  attempts: number;
  /** HR saved an experience value; the AI must not set it. */
  experienceSet: boolean;
  notBefore: number;
  updatedAt: number;
  error?: string;
};

type QueueData = { version: 1; jobs: Record<string, ProfileJob> };

export type ProfileWorkerDeps = {
  db: PrismaClient;
  queueFile: string;
  aiProfile: (text: string) => Promise<AiProfile>;
  readResume: (relativePath: string) => Promise<Buffer>;
  extractText: (args: { buffer: Buffer; mimeType: string; fileName: string }) => Promise<string>;
  ocr: (buffer: Buffer) => Promise<string>;
  embed: (candidateId: string) => Promise<unknown>;
  isTransient: (err: unknown) => boolean;
  errorCode: (err: unknown) => string;
  /** The AI call was cancelled so a foreground request could use the model. */
  isPreempted: (err: unknown) => boolean;
  /** Foreground AI is running or ran very recently. */
  foregroundBusy: () => boolean;
  liveInterviews: () => Promise<number>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type WorkerState = { running: boolean; lock: Promise<unknown> };
const g = globalThis as typeof globalThis & { __hireosProfileQueue?: WorkerState };
const shared: WorkerState = (g.__hireosProfileQueue ??= { running: false, lock: Promise.resolve() });

export async function defaultQueueFile(): Promise<string> {
  const { getStorageRoot } = await import("@/lib/storage");
  return path.join(getStorageRoot(), "queue", "resume-profile.json");
}

async function readQueue(file: string): Promise<QueueData> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<QueueData>;
    if (parsed && parsed.version === 1 && parsed.jobs && typeof parsed.jobs === "object") return parsed as QueueData;
  } catch {
    /* missing or unreadable: start empty */
  }
  return { version: 1, jobs: {} };
}

async function writeQueue(file: string, data: QueueData, now: number): Promise<void> {
  for (const [id, job] of Object.entries(data.jobs)) {
    const keep = job.status === "done" ? KEEP_DONE_MS : job.status === "failed" ? KEEP_FAILED_MS : Infinity;
    if (now - job.updatedAt > keep) delete data.jobs[id];
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), "utf8");
  await fs.rename(tmp, file);
}

/** Serialized read-modify-write of the queue file. */
async function withQueue<T>(file: string, now: number, fn: (data: QueueData) => T): Promise<T> {
  const run = shared.lock.then(async () => {
    const data = await readQueue(file);
    const result = fn(data);
    await writeQueue(file, data, now);
    return result;
  });
  shared.lock = run.catch(() => undefined);
  return run;
}

export async function enqueueProfileJobs(
  file: string,
  jobs: Array<{ candidateId: string; organizationId: string; experienceSet: boolean }>,
  now = Date.now(),
): Promise<void> {
  if (jobs.length === 0) return;
  await withQueue(file, now, (data) => {
    for (const j of jobs) {
      data.jobs[j.candidateId] = { ...j, status: "pending", attempts: 0, notBefore: now, updatedAt: now };
    }
  });
}

export async function profileJobStatus(
  file: string,
  candidateId: string,
  organizationId: string,
): Promise<{ status: ProfileJobStatus; error?: string } | null> {
  const job = (await readQueue(file)).jobs[candidateId];
  if (!job || job.organizationId !== organizationId) return null;
  return { status: job.status, error: job.error };
}

/** After a restart nothing is running: put interrupted jobs back in the queue. */
export async function recoverProfileJobs(file: string, now = Date.now()): Promise<number> {
  return withQueue(file, now, (data) => {
    let n = 0;
    for (const job of Object.values(data.jobs)) {
      if (job.status === "running") {
        job.status = "pending";
        job.updatedAt = now;
        n++;
      }
    }
    return n;
  });
}

type Values = Pick<ResumeProfile, "location" | "linkedIn" | "summary" | "skills" | "education" | "certifications"> & {
  experienceYears: number | null;
};

/** Writes each value only where that field is still empty; one atomic conditional update per field. */
export async function fillEmptyProfile(
  db: PrismaClient,
  candidateId: string,
  organizationId: string,
  v: Values,
  experienceSet: boolean,
): Promise<string[]> {
  const filled: string[] = [];
  const where = { id: candidateId, organizationId };
  const set = async (field: string, condition: object, data: object) => {
    const r = await db.candidate.updateMany({ where: { ...where, ...condition }, data });
    if (r.count > 0) filled.push(field);
  };
  const blank = (field: "location" | "linkedIn" | "summary") => ({ OR: [{ [field]: null }, { [field]: "" }] });
  if (v.location) await set("location", blank("location"), { location: v.location });
  if (v.linkedIn) await set("linkedIn", blank("linkedIn"), { linkedIn: v.linkedIn });
  if (v.summary) await set("summary", blank("summary"), { summary: v.summary });
  if (v.skills.length > 0) await set("skills", { skills: { isEmpty: true } }, { skills: v.skills });
  if (v.education.length > 0) await set("education", { education: { equals: [] } }, { education: v.education });
  if (v.certifications.length > 0) {
    await set("certifications", { certifications: { equals: [] } }, { certifications: v.certifications });
  }
  if (!experienceSet && v.experienceYears) await set("experience", { experience: 0 }, { experience: v.experienceYears });
  return filled;
}

const PAGE_MARKER = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm;

function cleanText(text: string): string {
  return text.replace(PAGE_MARKER, "").replace(/\n{3,}/g, "\n\n").trim();
}

type Outcome =
  | { kind: "done" }
  | { kind: "deferred" }
  | { kind: "retry"; error: string }
  | { kind: "failed"; error: string };

export async function runProfileJob(job: ProfileJob, deps: ProfileWorkerDeps): Promise<Outcome> {
  const { db } = deps;
  const c = await db.candidate.findFirst({
    where: { id: job.candidateId, organizationId: job.organizationId },
    select: { id: true, resumeText: true, resumeUrl: true },
  });
  if (!c) return { kind: "done" };

  let text = c.resumeText?.trim() ?? "";
  if (!text && c.resumeUrl) {
    const buffer = await deps.readResume(c.resumeUrl);
    const lower = c.resumeUrl.toLowerCase();
    const mimeType = lower.endsWith(".pdf")
      ? "application/pdf"
      : lower.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "text/plain";
    text = cleanText(await deps.extractText({ buffer, mimeType, fileName: path.basename(c.resumeUrl) }).catch(() => ""));
    if (!text && mimeType === "application/pdf") text = cleanText(await deps.ocr(buffer));
    if (text) {
      await db.candidate.updateMany({ where: { id: c.id, organizationId: job.organizationId, resumeText: null }, data: { resumeText: text } });
      await fillEmptyProfile(db, c.id, job.organizationId, extractResumeProfile(text), job.experienceSet);
    }
  }
  if (!text) return { kind: "failed", error: "no_readable_text" };

  try {
    const ai = await deps.aiProfile(text);
    await fillEmptyProfile(db, c.id, job.organizationId, ai, job.experienceSet);
  } catch (err) {
    if (deps.isPreempted(err)) return { kind: "deferred" };
    const error = deps.errorCode(err);
    return deps.isTransient(err) ? { kind: "retry", error } : { kind: "failed", error };
  }
  await deps.embed(c.id).catch(() => undefined);
  return { kind: "done" };
}

/** Runs the oldest due job. Returns "idle" when nothing is queued, or how long to wait for the next due job. */
export async function processNextProfileJob(
  deps: ProfileWorkerDeps,
): Promise<{ kind: "ran" } | { kind: "idle" } | { kind: "wait"; ms: number }> {
  const now = deps.now ?? Date.now;
  const picked = await withQueue(deps.queueFile, now(), (data) => {
    const pending = Object.values(data.jobs)
      .filter((j) => j.status === "pending")
      .sort((a, b) => a.notBefore - b.notBefore || a.updatedAt - b.updatedAt);
    if (pending.length === 0) return { kind: "idle" as const };
    const due = pending[0];
    if (due.notBefore > now()) return { kind: "wait" as const, ms: due.notBefore - now() };
    due.status = "running";
    due.attempts += 1;
    due.updatedAt = now();
    return { kind: "job" as const, job: { ...due } };
  });
  if (picked.kind !== "job") return picked;

  const { job } = picked;
  let outcome: Outcome;
  try {
    outcome = await runProfileJob(job, deps);
  } catch (err) {
    outcome = { kind: "retry", error: deps.errorCode(err) };
  }
  await withQueue(deps.queueFile, now(), (data) => {
    const current = data.jobs[job.candidateId];
    if (!current) return;
    current.updatedAt = now();
    if (outcome.kind === "done") {
      current.status = "done";
      delete current.error;
    } else if (outcome.kind === "deferred") {
      current.status = "pending";
      current.attempts = Math.max(0, current.attempts - 1);
      current.notBefore = now() + PREEMPTED_DELAY_MS;
    } else if (outcome.kind === "retry" && current.attempts < MAX_PROFILE_ATTEMPTS) {
      current.status = "pending";
      current.error = outcome.error;
      current.notBefore = now() + RETRY_DELAY_MS * current.attempts;
    } else {
      current.status = "failed";
      current.error = outcome.error;
    }
  });
  return { kind: "ran" };
}

/** Starts the single background worker if it is not already running in this process. */
export function kickProfileWorker(getDeps: () => Promise<ProfileWorkerDeps>): void {
  if (shared.running) return;
  shared.running = true;
  let queueFile: string | null = null;
  void (async () => {
    try {
      const deps = await getDeps();
      queueFile = deps.queueFile;
      const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
      for (;;) {
        if ((await deps.liveInterviews().catch(() => 0)) > 0) {
          await sleep(LIVE_INTERVIEW_WAIT_MS);
          continue;
        }
        if (deps.foregroundBusy()) {
          await sleep(FOREGROUND_WAIT_MS);
          continue;
        }
        const r = await processNextProfileJob(deps);
        if (r.kind === "idle") break;
        if (r.kind === "wait") await sleep(Math.min(r.ms, RETRY_DELAY_MS));
      }
    } catch (err) {
      queueFile = null;
      console.error("[resume-profile] worker stopped", { name: err instanceof Error ? err.name : typeof err });
    } finally {
      shared.running = false;
    }
    // A job enqueued while the loop was finishing would otherwise wait for the next upload.
    if (queueFile && Object.values((await readQueue(queueFile)).jobs).some((j) => j.status === "pending")) {
      kickProfileWorker(getDeps);
    }
  })();
}
