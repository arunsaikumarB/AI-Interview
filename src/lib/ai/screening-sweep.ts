import type { PrismaClient } from "@prisma/client";
import { AUTO_SCREENING_FAILED_KIND } from "./auto-screening";

/**
 * Screens every application that has resume text and no resume screening yet, newest first,
 * whatever its job, stage or status, so staff never have to start screening by hand.
 * Finds work in the database (survives restarts), hands one application at a time to the
 * automatic screening queue, and waits for it before taking the next.
 * Bounded (R-3): an application whose automatic screening failed MAX_FAILURES times is left for
 * staff; after a failure it waits RETRY_AFTER_MINUTES before the next try.
 * Advisory only: never changes application stage or status.
 */

export const SWEEP_MAX_FAILURES = 3;
export const SWEEP_RETRY_AFTER_MINUTES = 30;
const MAX_PER_RUN = 20;
const FIRST_RUN_DELAY_MS = 90_000;
const DEFAULT_INTERVAL_MINUTES = 2;

/** Newest application with resume text, no resume screening, and automatic retries left. */
export async function findUnscreenedApplication(
  db: PrismaClient,
  maxFailures = SWEEP_MAX_FAILURES,
  retryAfterMinutes = SWEEP_RETRY_AFTER_MINUTES,
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT a.id
    FROM "Application" a
    JOIN "Candidate" c ON c.id = a."candidateId"
    WHERE c."resumeText" ~ '[^[:space:]]'
      AND NOT EXISTS (
        SELECT 1 FROM "AIEvaluation" e
        WHERE e."applicationId" = a.id AND e.kind = 'RESUME_SCREEN'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "TimelineEvent" t
        WHERE t."applicationId" = a.id AND t.type = 'OTHER'
          AND t.payload->>'kind' = ${AUTO_SCREENING_FAILED_KIND}
          AND t."createdAt" > (now() AT TIME ZONE 'UTC') - make_interval(mins => ${retryAfterMinutes}::int)
      )
      AND (
        SELECT count(*) FROM "TimelineEvent" t
        WHERE t."applicationId" = a.id AND t.type = 'OTHER'
          AND t.payload->>'kind' = ${AUTO_SCREENING_FAILED_KIND}
      ) < ${maxFailures}::int
    ORDER BY a."createdAt" DESC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export type ScreeningSweepDeps = {
  next: () => Promise<string | null>;
  /** False when the automatic queue is full. */
  enqueue: (applicationId: string) => boolean;
  queueIdle: () => Promise<void>;
  /** True while background AI should wait (live interview, staff AI, resume reading, Ollama down). */
  busy: () => Promise<boolean>;
};

/** One pass: screens up to `maxPerRun` applications, one at a time. Returns how many were handed over. */
export async function sweepOnce(deps: ScreeningSweepDeps, maxPerRun = MAX_PER_RUN): Promise<number> {
  const seen = new Set<string>();
  while (seen.size < maxPerRun) {
    if (await deps.busy()) break;
    const id = await deps.next();
    // Seen again in the same pass: it gave way to other AI or could not be recorded; try next pass.
    if (!id || seen.has(id)) break;
    if (!deps.enqueue(id)) break;
    seen.add(id);
    await deps.queueIdle();
  }
  return seen.size;
}

/** Minutes between sweeps; 0 = off. Unset: every 2 minutes in production, off in development. */
export function sweepIntervalMinutes(env: Record<string, string | undefined> = process.env): number {
  const fallback = env.NODE_ENV === "production" ? DEFAULT_INTERVAL_MINUTES : 0;
  const raw = env.AUTO_SCREENING_SWEEP_MINUTES?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n === 0 ? 0 : Math.min(n, 60);
}

const holder = globalThis as typeof globalThis & {
  __hireosScreeningSweepTimer?: ReturnType<typeof setInterval>;
  __hireosScreeningSweepRunning?: boolean;
};

/** Called once at server start. */
export async function startScreeningSweep(): Promise<void> {
  const minutes = sweepIntervalMinutes();
  if (minutes === 0 || holder.__hireosScreeningSweepTimer) return;
  const [{ prisma }, { queueAutoScreening, autoScreeningIdle, backgroundAiBusy }] = await Promise.all([
    import("@/lib/db"),
    import("./auto-screening"),
  ]);
  const deps: ScreeningSweepDeps = {
    next: () => findUnscreenedApplication(prisma),
    enqueue: queueAutoScreening,
    queueIdle: autoScreeningIdle,
    busy: () => backgroundAiBusy().catch(() => true),
  };
  const tick = () => {
    if (holder.__hireosScreeningSweepRunning) return;
    holder.__hireosScreeningSweepRunning = true;
    void sweepOnce(deps)
      .then((n) => {
        if (n > 0) console.info("[screening-sweep] pass finished", { applications: n });
      })
      .catch((err: unknown) => console.error("[screening-sweep] failed", { name: err instanceof Error ? err.name : typeof err }))
      .finally(() => {
        holder.__hireosScreeningSweepRunning = false;
      });
  };
  holder.__hireosScreeningSweepTimer = setInterval(tick, minutes * 60_000);
  holder.__hireosScreeningSweepTimer.unref?.();
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref?.();
  console.info("[screening-sweep] scheduled", { everyMinutes: minutes });
}
