/**
 * Advisory resume screening started automatically after staff add someone to a job.
 * Runs one screening at a time in this server process (local Ollama), with a capped waiting list.
 * Never changes application stage or status. A failed run stores no AIEvaluation: it is recorded on
 * the application timeline so staff can run screening again from the candidate page.
 * Waiting runs are lost if the server restarts; staff can still run screening by hand.
 */

export const AUTO_SCREENING_MAX_PENDING = 50;
export const AUTO_SCREENING_FAILED_KIND = "ai_screening_failed";

export type AutoScreeningDeps = {
  screen: (applicationId: string) => Promise<unknown>;
  recordFailure: (applicationId: string, code: string) => Promise<void>;
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
      try {
        await d.screen(id);
      } catch (err) {
        const code = errorCode(err);
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

async function productionDeps(): Promise<AutoScreeningDeps> {
  const [{ prisma }, { screenApplication }] = await Promise.all([import("@/lib/db"), import("@/lib/ai/run-screening")]);
  return {
    screen: screenApplication,
    recordFailure: async (applicationId, code) => {
      await prisma.timelineEvent.create({
        data: {
          applicationId,
          type: "OTHER",
          payload: { kind: AUTO_SCREENING_FAILED_KIND, code, automatic: true, advisoryOnly: true },
        },
      });
    },
  };
}

const holder = globalThis as typeof globalThis & { __hireosAutoScreening?: AutoScreeningQueue };

export function queueAutoScreening(applicationId: string): boolean {
  holder.__hireosAutoScreening ??= createAutoScreeningQueue(productionDeps);
  return holder.__hireosAutoScreening.enqueue(applicationId);
}
