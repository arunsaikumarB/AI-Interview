/**
 * Advisory resume screening that staff do not start by hand: new careers applicants, people added
 * to a job, Screen all, and the background sweep (screening-sweep.ts) that finds every application
 * with a resume and no screening yet.
 * Runs one screening at a time in this server process (local Ollama), with a capped waiting list.
 * Low priority: waits while an interview is live, staff-started AI is running, resumes are still
 * being read, or Ollama is not answering; and its AI call gives way to those (not a failure).
 * Never changes application stage or status. A failed run stores no AIEvaluation: it is recorded on
 * the application timeline (the sweep retries a limited number of times; staff can run it by hand).
 * Waiting runs are lost if the server restarts; the sweep finds them again.
 */

export const AUTO_SCREENING_MAX_PENDING = 50;
export const AUTO_SCREENING_FAILED_KIND = "ai_screening_failed";
const CAPACITY_POLL_MS = 30_000;
const LIVE_INTERVIEW_WINDOW_MS = 30 * 60_000;
const OLLAMA_CHECK_TIMEOUT_MS = 10_000;

export type AutoScreeningDeps = {
  screen: (applicationId: string) => Promise<unknown>;
  recordFailure: (applicationId: string, code: string) => Promise<void>;
  /** Resolves once the local AI is free for background work. */
  waitForCapacity?: () => Promise<void>;
};

export type AutoScreeningQueue = {
  /** False when the waiting list is full; the application is then not queued. */
  enqueue: (applicationId: string) => boolean;
  /** Resolves when nothing is running or waiting. */
  idle: () => Promise<void>;
};

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z_]{1,40}$/.test(code)) return code;
  return err instanceof Error ? err.name.slice(0, 40) : "unknown";
}

export function createAutoScreeningQueue(
  deps: () => Promise<AutoScreeningDeps>,
  maxPending = AUTO_SCREENING_MAX_PENDING,
): AutoScreeningQueue {
  const pending: string[] = [];
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    const d = await deps();
    for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
      if (d.waitForCapacity) await d.waitForCapacity().catch(() => undefined);
      try {
        await d.screen(id);
      } catch (err) {
        const code = errorCode(err);
        if (code === "PREEMPTED") {
          console.info("[auto-screening] gave way to foreground AI");
          continue;
        }
        console.warn("[auto-screening] failed", { code });
        await d.recordFailure(id, code).catch(() => undefined);
      }
    }
  }

  function start(): void {
    if (running) return;
    running = drain()
      .catch((err) => console.error("[auto-screening] stopped", { code: errorCode(err) }))
      .finally(() => {
        running = null;
        if (pending.length) start();
      });
  }

  return {
    enqueue(applicationId) {
      if (pending.includes(applicationId)) return true;
      if (pending.length >= maxPending) return false;
      pending.push(applicationId);
      start();
      return true;
    },
    async idle() {
      while (running) await running;
    },
  };
}

/** True while background AI should wait: live interview, staff-started AI, resume reading, or Ollama down. */
export async function backgroundAiBusy(): Promise<boolean> {
  const [{ prisma }, { foregroundChatBusy, healthCheck }, { profileWorkerRunning }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/ai/ollama"),
    import("@/lib/resume-upload/profile-queue"),
  ]);
  if (foregroundChatBusy() || profileWorkerRunning()) return true;
  const live = await prisma.interviewSession.count({
    where: { status: "IN_PROGRESS", updatedAt: { gte: new Date(Date.now() - LIVE_INTERVIEW_WINDOW_MS) } },
  });
  if (live > 0) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), OLLAMA_CHECK_TIMEOUT_MS);
  });
  const answers = await Promise.race([healthCheck().then((h) => h.ok, () => false), timedOut]);
  clearTimeout(timer);
  return !answers;
}

async function productionDeps(): Promise<AutoScreeningDeps> {
  const [{ prisma }, { screenApplication }] = await Promise.all([import("@/lib/db"), import("@/lib/ai/run-screening")]);
  return {
    screen: (applicationId) => screenApplication(applicationId, { background: true }),
    recordFailure: async (applicationId, code) => {
      await prisma.timelineEvent.create({
        data: {
          applicationId,
          type: "OTHER",
          payload: { kind: AUTO_SCREENING_FAILED_KIND, code, automatic: true, advisoryOnly: true },
        },
      });
    },
    waitForCapacity: async () => {
      while (await backgroundAiBusy().catch(() => true)) {
        await new Promise((r) => setTimeout(r, CAPACITY_POLL_MS));
      }
    },
  };
}

const holder = globalThis as typeof globalThis & { __hireosAutoScreening?: AutoScreeningQueue };

function sharedQueue(): AutoScreeningQueue {
  holder.__hireosAutoScreening ??= createAutoScreeningQueue(productionDeps);
  return holder.__hireosAutoScreening;
}

export function queueAutoScreening(applicationId: string): boolean {
  return sharedQueue().enqueue(applicationId);
}

/** Resolves when the automatic queue has nothing running or waiting. */
export function autoScreeningIdle(): Promise<void> {
  return sharedQueue().idle();
}
