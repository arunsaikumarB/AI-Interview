/**
 * Screening started by staff from the candidate page. Runs in the background of this server
 * process so the browser never waits on one long request (a busy CPU model can take minutes,
 * longer than a proxy will hold a connection). The page polls the status instead.
 * Never changes application stage or status. A failed run stores no AIEvaluation.
 * Status is kept in memory only; after a restart the page reports that nothing is running.
 */

export const MANUAL_SCREENING_MAX_RUNNING = 2;
const KEEP_FINISHED_MS = 10 * 60 * 1000;
/** Longest a screening can run (two 4-minute AI attempts plus waiting); after this it is reported as not finished. */
export const SCREENING_GIVE_UP_MS = 10 * 60 * 1000;
/** Clock difference allowed between this server and the database when matching a new result. */
export const SCREENING_CLOCK_SLACK_MS = 60 * 1000;
const NO_RUN_MESSAGE = "No screening is running for this candidate. Run AI screening again.";
const NOT_FINISHED_MESSAGE = "The screening did not finish. Run AI screening again.";

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

/** `since` from the status URL: an ISO time no later than now (plus clock slack) and under a day old. */
export function parseScreeningSince(raw: string | null, now: number = Date.now()): Date | null {
  if (!raw || raw.length > 40) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t > now + SCREENING_CLOCK_SLACK_MS || now - t > 24 * 3600_000) return null;
  return new Date(t);
}

/**
 * Status when this server process has no record of the run (the request reached another app
 * process, or this one restarted): a result saved since the click means it finished; otherwise it
 * may still be running elsewhere until SCREENING_GIVE_UP_MS has passed.
 */
export function fallbackScreeningStatus(args: {
  since: Date | null;
  resultSince: boolean;
  now?: number;
}): { status: ManualScreeningStatus; error?: string } {
  if (!args.since) return { status: "FAILED", error: NO_RUN_MESSAGE };
  if (args.resultSince) return { status: "COMPLETED" };
  if ((args.now ?? Date.now()) - args.since.getTime() < SCREENING_GIVE_UP_MS) return { status: "PROCESSING" };
  return { status: "FAILED", error: NOT_FINISHED_MESSAGE };
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
