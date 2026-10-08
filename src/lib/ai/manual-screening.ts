/**
 * Screening started by staff from the candidate page. Runs in the background of this server
 * process so the browser never waits on one long request (a busy CPU model can take minutes,
 * longer than a proxy will hold a connection). The page polls the status instead.
 * Never changes application stage or status. A failed run stores no AIEvaluation.
 * Status is kept in memory only; after a restart the page reports that nothing is running.
 */

export const MANUAL_SCREENING_MAX_RUNNING = 2;
const KEEP_FINISHED_MS = 10 * 60 * 1000;

export type ManualScreeningStatus = "PROCESSING" | "COMPLETED" | "FAILED";

type Entry = { status: ManualScreeningStatus; error?: string; finishedAt?: number };

export type StartResult = "QUEUED" | "ALREADY_PROCESSING" | "BUSY";

export type ManualScreeningRunner = {
  start: (applicationId: string) => StartResult;
  status: (applicationId: string) => { status: ManualScreeningStatus; error?: string } | null;
  idle: () => Promise<void>;
};

export function screeningFailureMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "VALIDATION" && err instanceof Error && err.message.length <= 200) return err.message;
  if (code === "OLLAMA_UNREACHABLE" || code === "OLLAMA_HTTP" || code === "PREEMPTED") {
    return "The local AI is unavailable or too busy right now. Try again in a few minutes.";
  }
  if (code === "INVALID_JSON") return "The AI returned an answer that could not be read. Try again.";
  return "Screening failed. Try again.";
}

export function createManualScreeningRunner(
  screen: (applicationId: string) => Promise<unknown>,
  now: () => number = Date.now,
  maxRunning = MANUAL_SCREENING_MAX_RUNNING,
): ManualScreeningRunner {
  const entries = new Map<string, Entry>();
  const running = new Set<Promise<void>>();

  function prune(): void {
    const t = now();
    for (const [id, e] of Array.from(entries)) {
      if (e.finishedAt !== undefined && t - e.finishedAt > KEEP_FINISHED_MS) entries.delete(id);
    }
  }

  return {
    start(applicationId) {
      prune();
      if (entries.get(applicationId)?.status === "PROCESSING") return "ALREADY_PROCESSING";
      if (running.size >= maxRunning) return "BUSY";
      entries.set(applicationId, { status: "PROCESSING" });
      const job = (async () => {
        try {
          await screen(applicationId);
          entries.set(applicationId, { status: "COMPLETED", finishedAt: now() });
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          console.warn("[screening] manual run failed", { code: typeof code === "string" ? code : "unknown" });
          entries.set(applicationId, { status: "FAILED", error: screeningFailureMessage(err), finishedAt: now() });
        }
      })();
      running.add(job);
      void job.finally(() => running.delete(job));
      return "QUEUED";
    },
    status(applicationId) {
      prune();
      const e = entries.get(applicationId);
      return e ? { status: e.status, ...(e.error ? { error: e.error } : {}) } : null;
    },
    async idle() {
      while (running.size) await Promise.all(Array.from(running));
    },
  };
}

const holder = globalThis as typeof globalThis & { __hireosManualScreening?: ManualScreeningRunner };

export function getManualScreeningRunner(): ManualScreeningRunner {
  holder.__hireosManualScreening ??= createManualScreeningRunner(async (applicationId) => {
    const { screenApplication } = await import("@/lib/ai/run-screening");
    return screenApplication(applicationId);
  });
  return holder.__hireosManualScreening;
}
