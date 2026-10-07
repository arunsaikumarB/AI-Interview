import { promises as fs } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { UploadDeps } from "@/lib/resume-upload/upload";
import { parseCareersConfig, createHttpCareersClient, type CareersClient } from "./client";
import { syncCareersApplications, type CareersSyncReport } from "./sync";
import { laterSiteTime, shiftSiteTime } from "./text";

/**
 * Runs the careers sync: one run at a time per server process, on a schedule and on demand.
 * Progress is kept in a small JSON file under STORAGE_ROOT. The first complete full read is the
 * initial import (no AI screening); later applications are screened (advisory only).
 */

const FULL_SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const INCREMENTAL_OVERLAP_MINUTES = 10;
const FIRST_RUN_DELAY_MS = 60_000;
const DEFAULT_INTERVAL_MINUTES = 15;

const reportSchema = z.object({
  mode: z.enum(["full", "incremental"]),
  complete: z.boolean(),
  error: z.string().nullable(),
  seen: z.number(),
  created: z.number(),
  linked: z.number(),
  alreadyImported: z.number(),
  withoutResume: z.number(),
  invalid: z.number(),
  failed: z.number(),
  jobsCreated: z.number(),
  jobsClosed: z.number(),
  screeningQueued: z.number(),
  latestAppliedOn: z.string().nullable(),
});

const stateSchema = z.object({
  /** Newest applied_on fully imported (site time); incremental runs start a little before it. */
  cursor: z.string().nullable().default(null),
  lastFullAt: z.string().nullable().default(null),
  /** Set once the first complete full read finished. Applications after it get AI screening. */
  screenAfter: z.string().nullable().default(null),
  lastRun: z
    .object({
      trigger: z.enum(["schedule", "manual"]),
      startedAt: z.string(),
      finishedAt: z.string(),
      report: reportSchema,
    })
    .nullable()
    .default(null),
});

export type CareersSyncState = z.infer<typeof stateSchema>;

export type CareersSyncStatus = {
  configured: boolean;
  intervalMinutes: number;
  running: boolean;
  initialImportDone: boolean;
  lastRun: CareersSyncState["lastRun"];
};

export type CareersRunResult =
  | { status: "done"; report: CareersSyncReport }
  | { status: "busy" }
  | { status: "not_configured" }
  | { status: "no_organization" }
  | { status: "no_staff_user" };

export type CareersRunnerDeps = {
  db: PrismaClient;
  client: CareersClient;
  upload: UploadDeps;
  queueScreening?: (applicationId: string) => boolean;
  stateFile: string;
  now?: () => Date;
};

/** Minutes between automatic runs; 0 = off. Unset: every 15 minutes in production, off in development. */
export function intervalMinutes(env: Record<string, string | undefined> = process.env): number {
  const fallback = env.NODE_ENV === "production" ? DEFAULT_INTERVAL_MINUTES : 0;
  const raw = env.CAREERS_SYNC_INTERVAL_MINUTES?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n === 0 ? 0 : Math.min(Math.max(n, 5), 24 * 60);
}

export async function readCareersState(file: string): Promise<CareersSyncState> {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(await fs.readFile(file, "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // Missing or unreadable: start fresh (imports are de-duplicated, so a re-read is harmless).
  }
  return stateSchema.parse({});
}

async function writeState(file: string, state: CareersSyncState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, file);
}

async function resolveOrganizationId(db: PrismaClient, configured: string | undefined): Promise<string | null> {
  const wanted = configured?.trim();
  if (wanted) {
    const org = await db.organization.findUnique({ where: { id: wanted }, select: { id: true } });
    return org?.id ?? null;
  }
  const orgs = await db.organization.findMany({ select: { id: true }, take: 2 });
  return orgs.length === 1 ? orgs[0].id : null;
}

async function resolveActorId(db: PrismaClient, organizationId: string, preferred?: string): Promise<string | null> {
  if (preferred) {
    const user = await db.user.findFirst({
      where: { id: preferred, organizationId, isActive: true, role: { in: ["SUPER_ADMIN", "HR_ADMIN"] } },
      select: { id: true },
    });
    if (user) return user.id;
  }
  const fallback = await db.user.findFirst({
    where: { organizationId, isActive: true, role: { in: ["SUPER_ADMIN", "HR_ADMIN"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

export function createCareersRunner(deps: CareersRunnerDeps, env: Record<string, string | undefined> = process.env) {
  const now = deps.now ?? (() => new Date());
  let running: Promise<CareersRunResult> | null = null;

  async function runOnce(trigger: "schedule" | "manual", userId?: string): Promise<CareersRunResult> {
    const organizationId = await resolveOrganizationId(deps.db, env.CAREERS_ORGANIZATION_ID);
    if (!organizationId) return { status: "no_organization" };
    const actorId = await resolveActorId(deps.db, organizationId, userId);
    if (!actorId) return { status: "no_staff_user" };

    const state = await readCareersState(deps.stateFile);
    const startedAt = now();
    const initialDone = state.screenAfter !== null;
    const fullDue = !state.lastFullAt || startedAt.getTime() - Date.parse(state.lastFullAt) >= FULL_SWEEP_EVERY_MS;
    const mode = trigger === "manual" || !initialDone || fullDue || !state.cursor ? "full" : "incremental";

    const report = await syncCareersApplications(
      deps.db,
      { client: deps.client, upload: deps.upload, queueScreening: deps.queueScreening },
      {
        organizationId,
        actorId,
        mode,
        after: state.cursor ? shiftSiteTime(state.cursor, -INCREMENTAL_OVERLAP_MINUTES) : null,
        screenAfter: initialDone ? state.screenAfter : null,
      },
    );

    const next: CareersSyncState = { ...state };
    if (report.complete && report.failed === 0) next.cursor = laterSiteTime(state.cursor, report.latestAppliedOn);
    if (mode === "full" && report.complete) {
      next.lastFullAt = startedAt.toISOString();
      if (!initialDone) next.screenAfter = report.latestAppliedOn ?? "0000-00-00 00:00:00";
    }
    next.lastRun = { trigger, startedAt: startedAt.toISOString(), finishedAt: now().toISOString(), report };
    await writeState(deps.stateFile, next);
    return { status: "done", report };
  }

  return {
    /** The organization imports go to (CAREERS_ORGANIZATION_ID, or the only organization). */
    organizationId(): Promise<string | null> {
      return resolveOrganizationId(deps.db, env.CAREERS_ORGANIZATION_ID);
    },
    isRunning(): boolean {
      return running !== null;
    },
    /** Starts a run unless one is already going. Manual runs always read every page. */
    run(trigger: "schedule" | "manual", userId?: string): Promise<CareersRunResult> {
      if (running) return Promise.resolve({ status: "busy" });
      running = runOnce(trigger, userId).finally(() => {
        running = null;
      });
      return running;
    },
    async status(): Promise<CareersSyncStatus> {
      const state = await readCareersState(deps.stateFile);
      return {
        configured: true,
        intervalMinutes: intervalMinutes(env),
        running: running !== null,
        initialImportDone: state.screenAfter !== null,
        lastRun: state.lastRun,
      };
    },
  };
}

type Runner = ReturnType<typeof createCareersRunner>;
const holder = globalThis as typeof globalThis & {
  __hireosCareersRunner?: Runner | null;
  __hireosCareersTimer?: ReturnType<typeof setInterval>;
};

/** The server's runner, or null when CAREERS_API_URL / CAREERS_API_KEY are not set. */
export async function getCareersRunner(): Promise<Runner | null> {
  if (holder.__hireosCareersRunner !== undefined) return holder.__hireosCareersRunner;
  const config = parseCareersConfig();
  if (!config) {
    holder.__hireosCareersRunner = null;
    return null;
  }
  const [{ prisma }, { getStorageRoot }, { extractResumeText }, { embedCandidate }, { queueProfileReading }, { queueAutoScreening }] =
    await Promise.all([
      import("@/lib/db"),
      import("@/lib/storage"),
      import("@/lib/resume/parse"),
      import("@/lib/ai/embeddings"),
      import("@/lib/resume-upload/profile-worker"),
      import("@/lib/ai/auto-screening"),
    ]);
  holder.__hireosCareersRunner = createCareersRunner({
    db: prisma,
    client: createHttpCareersClient(config),
    upload: { extractText: extractResumeText, embed: embedCandidate, queueProfile: queueProfileReading },
    queueScreening: queueAutoScreening,
    stateFile: path.join(getStorageRoot(), "integrations", "careers-sync.json"),
  });
  return holder.__hireosCareersRunner;
}

export function logResult(result: CareersRunResult): void {
  if (result.status === "done") {
    const r = result.report;
    console.info("[careers-sync] finished", {
      mode: r.mode,
      complete: r.complete,
      error: r.error,
      seen: r.seen,
      created: r.created,
      linked: r.linked,
      failed: r.failed,
      jobsCreated: r.jobsCreated,
      jobsClosed: r.jobsClosed,
      screeningQueued: r.screeningQueued,
    });
  } else if (result.status !== "busy") {
    console.warn("[careers-sync] skipped", { status: result.status });
  }
}

/** Called once at server start. Does nothing unless the careers API is configured. */
export async function startCareersSyncSchedule(): Promise<void> {
  const minutes = intervalMinutes();
  if (minutes === 0 || holder.__hireosCareersTimer) return;
  const runner = await getCareersRunner();
  if (!runner) return;
  const tick = () => {
    void runner
      .run("schedule")
      .then(logResult)
      .catch((err: unknown) => console.error("[careers-sync] failed", { name: err instanceof Error ? err.name : typeof err }));
  };
  holder.__hireosCareersTimer = setInterval(tick, minutes * 60_000);
  holder.__hireosCareersTimer.unref?.();
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  console.info("[careers-sync] scheduled", { everyMinutes: minutes });
}
