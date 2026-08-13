"use client";

import { Badge } from "@/components/ui/badge";
import { recordingStatusLabel } from "@/lib/secondary-recording-labels";

function formatMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Recruiter review artifact — secondary camera recording.
 * Neutral language only. Never claims cheating.
 */
export function SecondaryRecordingReport({
  interviewId,
  status,
  durationMs,
  interruptedMs,
  hasGap,
  hasPath,
}: {
  interviewId: string;
  status: string;
  durationMs: number | null;
  interruptedMs: number;
  hasGap: boolean;
  hasPath: boolean;
}) {
  if (status === "NONE" && !hasPath) return null;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            Secondary Camera Recording
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Review artifact only — not used for AI scoring or automatic hiring
            decisions. Does not prove Bluetooth earphones, remote desktop apps,
            or cheating.
          </p>
        </div>
        <Badge variant="secondary">{recordingStatusLabel(status)}</Badge>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium text-foreground">
            {hasPath ? "Recorded" : status}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="font-medium text-foreground">{formatMs(durationMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Recording quality</dt>
          <dd className="font-medium text-foreground">
            {hasPath ? "Available" : "Not available"}
          </dd>
        </div>
      </dl>

      {hasGap || interruptedMs > 0 ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-foreground">
          Secondary recording contains an interruption
          {interruptedMs > 0 ? ` (${formatMs(interruptedMs)}).` : "."}
        </p>
      ) : null}

      {hasPath ? (
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/interviews/${interviewId}/secondary-recording/file`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center rounded-lg border border-border bg-secondary px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
          >
            Play Recording
          </a>
          <a
            href={`/api/interviews/${interviewId}/secondary-recording/file?download=1`}
            className="inline-flex h-7 items-center rounded-lg px-2.5 text-[0.8rem] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Download Recording
          </a>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {status === "FAILED"
            ? "No playable file was saved for this session (chunks were missing or empty after the interruption)."
            : "Secondary recording available for review once finalized."}
        </p>
      )}
    </section>
  );
}
