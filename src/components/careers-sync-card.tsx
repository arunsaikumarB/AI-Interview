"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Report = {
  mode: "full" | "incremental";
  complete: boolean;
  error: string | null;
  seen: number;
  created: number;
  linked: number;
  alreadyImported: number;
  withoutResume: number;
  invalid: number;
  failed: number;
  jobsCreated: number;
  jobsClosed: number;
  screeningQueued: number;
};

type Status =
  | { configured: false }
  | {
      configured: true;
      intervalMinutes: number;
      running: boolean;
      initialImportDone: boolean;
      lastRun: { trigger: "schedule" | "manual"; startedAt: string; finishedAt: string; report: Report } | null;
    };

const ERROR_TEXT: Record<string, string> = {
  unreachable: "the careers site could not be reached",
  rejected_key: "the careers site rejected HireOS's key",
  bad_request: "the careers site refused the request",
  bad_response: "the careers site sent something unexpected",
  too_large: "the careers site sent too much data",
  database_unavailable: "the database was not available",
  too_many_pages: "there were more pages than expected",
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function summary(r: Report): string {
  const parts = [`${r.seen} application${r.seen === 1 ? "" : "s"} checked`];
  if (r.created) parts.push(`${r.created} new candidate${r.created === 1 ? "" : "s"}`);
  if (r.linked) parts.push(`${r.linked} existing candidate${r.linked === 1 ? "" : "s"} added to a job`);
  if (!r.created && !r.linked && r.complete) parts.push("nothing new");
  if (r.withoutResume) parts.push(`${r.withoutResume} without a usable resume`);
  if (r.jobsCreated) parts.push(`${r.jobsCreated} job${r.jobsCreated === 1 ? "" : "s"} added`);
  if (r.jobsClosed) parts.push(`${r.jobsClosed} expired job${r.jobsClosed === 1 ? "" : "s"} closed`);
  if (r.screeningQueued) parts.push(`${r.screeningQueued} sent for AI screening`);
  if (r.invalid) parts.push(`${r.invalid} skipped (no valid email)`);
  if (r.failed) parts.push(`${r.failed} could not be saved (will retry)`);
  return parts.join(" · ");
}

/** Admin card: careers site sync status and "Sync now". Shows counts only. */
export function CareersSyncCard() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/careers/sync", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as Status;
      setStatus(next);
      const running = next.configured && next.running;
      if (wasRunning.current && !running) router.refresh();
      wasRunning.current = running;
    } catch {
      // Status is informational; the next poll tries again.
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = status?.configured ? status.running : false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [running, load]);

  async function syncNow() {
    setStarting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/integrations/careers/sync", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && res.status !== 409) setMessage(body.error ?? "Could not start the sync. Try again.");
      await load();
    } catch {
      setMessage("Could not start the sync. Try again.");
    } finally {
      setStarting(false);
    }
  }

  if (!status || !status.configured) return null;
  const last = status.lastRun;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-foreground">LogiSoft careers page</p>
        <p className="text-muted-foreground">
          Active careers jobs and their applicants are brought in here
          {status.intervalMinutes > 0 ? ` every ${status.intervalMinutes} minutes` : " when you sync"}.
          {status.initialImportDone
            ? " New applicants get advisory AI screening."
            : " The first import runs without AI screening."}
        </p>
        {status.running ? (
          <p className="text-foreground" role="status">
            Syncing now… this can take a while the first time.
          </p>
        ) : last ? (
          <p className="text-muted-foreground" role="status">
            Last sync {when(last.finishedAt)}: {summary(last.report)}
            {last.report.error ? ` — stopped early because ${ERROR_TEXT[last.report.error] ?? "of an error"}.` : ""}
          </p>
        ) : (
          <p className="text-muted-foreground">Not synced yet.</p>
        )}
        {message ? (
          <p className="text-destructive" role="alert">
            {message}
          </p>
        ) : null}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={syncNow} disabled={starting || status.running}>
        {status.running ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
