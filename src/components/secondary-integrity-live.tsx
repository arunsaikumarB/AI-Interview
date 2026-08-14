"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { integritySignalLabel } from "@/lib/integrity";

type EventRow = {
  id: string;
  type: string;
  timestamp: string;
  meta?: unknown;
};

function metaObj(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object") return null;
  return meta as Record<string, unknown>;
}

function latestSecondary(events: EventRow[]): EventRow[] {
  return events
    .filter((e) => e.type.startsWith("SECONDARY_"))
    .slice(-8)
    .reverse();
}

export function SecondaryIntegrityLive({
  interviewId,
  candidateName,
  initialStatus,
  initialDeviceStatus,
}: {
  interviewId: string;
  candidateName: string;
  initialStatus: string;
  initialDeviceStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [device, setDevice] = useState(initialDeviceStatus);
  const [events, setEvents] = useState<EventRow[]>([]);
  const live = status === "IN_PROGRESS" || status === "WAITING";

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/interviews/${interviewId}/proctoring`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          events?: EventRow[];
          interviewStatus?: string;
          secondaryDeviceStatus?: string;
        };
        if (cancelled) return;
        if (data.interviewStatus) setStatus(data.interviewStatus);
        if (data.secondaryDeviceStatus) setDevice(data.secondaryDeviceStatus);
        setEvents(data.events ?? []);
      } catch {
        /* poll best-effort */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [interviewId]);

  const recent = latestSecondary(events);
  const last = recent[0];
  const missing = last?.type === "SECONDARY_NO_FACE";
  const attention =
    last?.type === "SECONDARY_ATTENTION_DEVIATION" ||
    last?.type === "SECONDARY_LOOKING_AT_DEVICE";
  const extraEvents = events.filter(
    (e) =>
      e.type === "SECONDARY_MULTIPLE_PERSONS" ||
      e.type === "SECONDARY_MULTIPLE_FACES",
  );
  const lastExtra = extraEvents[extraEvents.length - 1];
  const lastReturned = [...events]
    .reverse()
    .find((e) => e.type === "SECONDARY_PERSON_RETURNED_TO_ONE");
  const extraActive = Boolean(
    lastExtra &&
      (!lastReturned ||
        new Date(lastReturned.timestamp).getTime() <
          new Date(lastExtra.timestamp).getTime()),
  );
  const extraDurationSec = lastExtra
    ? Math.max(
        0.1,
        ((extraActive
          ? Date.now()
          : lastReturned
            ? new Date(lastReturned.timestamp).getTime()
            : Date.now()) -
          new Date(lastExtra.timestamp).getTime()) /
          1000,
      )
    : 0;
  const interaction = events.some(
    (e) => e.type === "SECONDARY_PERSON_INTERACTION",
  );
  const moved = last?.type === "SECONDARY_PERSON_MOVED";
  const connected = device === "CONNECTED";

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-medium text-foreground">Secondary camera</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Live environment signals for human review. Not proof of cheating.
        </p>
      </div>
      <ul className="space-y-1 text-sm text-foreground">
        <li>
          {connected ? "● Connected" : "○ Not connected"}
          {live ? " · Interview in progress" : ` · ${status}`}
        </li>
        <li>
          {missing ? "⚠ Candidate not visible" : "✓ Candidate visible"}
        </li>
        <li>
          {moved
            ? "⚠ Interview position unstable"
            : "✓ Interview position stable"}
        </li>
        <li>
          Integrity monitoring: {connected && live ? "Active" : "Inactive"}
        </li>
      </ul>
      {attention ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
          ⚠ Attention deviation detected
        </p>
      ) : null}
      {extraActive || lastExtra ? (
        <div className="space-y-1 rounded-lg bg-warning/10 px-3 py-2 text-sm">
          <p>⚠ Additional person detected</p>
          <p className="text-xs text-muted-foreground">
            Candidate: {candidateName}
          </p>
          {lastExtra ? (
            <p className="text-xs text-muted-foreground">
              Time: {formatDateTime(lastExtra.timestamp)}
              {extraDurationSec > 0
                ? ` · Duration: ${extraDurationSec.toFixed(1)} seconds`
                : ""}
            </p>
          ) : null}
          <p className="text-xs">Status: Review recommended</p>
          <a
            href="#secondary-camera-review"
            className="inline-block text-xs font-medium text-primary underline"
          >
            Jump to recording
          </a>
        </div>
      ) : null}
      {interaction ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
          ⚠ Possible interaction with another person detected. Review
          recommended.
        </p>
      ) : null}
      {recent.length > 0 ? (
        <ol className="max-h-40 space-y-1 overflow-y-auto text-xs">
          {recent.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="shrink-0 font-mono text-muted-foreground">
                {formatDateTime(e.timestamp)}
              </span>
              <span>
                {integritySignalLabel({ type: e.type, meta: metaObj(e.meta) })}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">No secondary signals yet.</p>
      )}
    </section>
  );
}
