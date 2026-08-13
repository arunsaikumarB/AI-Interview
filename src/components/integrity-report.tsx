"use client";

import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import {
  integritySignalLabel,
  parseIntegrityMode,
  terminationReasonLabel,
} from "@/lib/integrity";

type EventRow = {
  id: string;
  type: string;
  timestamp: string;
  meta: unknown;
};

function metaObj(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object") return null;
  return meta as Record<string, unknown>;
}

/**
 * Recruiter-facing integrity summary. Neutral language only.
 * Does not claim OS apps were detected or not detected.
 */
export function IntegrityReportSection({
  integrityMode,
  focusViolations,
  pasteViolations,
  terminatedReason,
  cameraMoveViolations = 0,
  status,
  events,
}: {
  integrityMode: string;
  focusViolations: number;
  pasteViolations: number;
  terminatedReason: string | null;
  cameraMoveViolations?: number;
  status: string;
  events: EventRow[];
}) {
  const mode = parseIntegrityMode(integrityMode);
  const terminated = status === "TERMINATED";
  const warnings = Math.max(
    0,
    focusViolations +
      pasteViolations +
      cameraMoveViolations -
      (terminated ? 1 : 0),
  );

  const signalEvents = events.filter((e) => {
    const m = metaObj(e.meta);
    if (m?.integrityViolation === true) return true;
    return (
      e.type === "TAB_BLUR" ||
      e.type === "FULLSCREEN_EXIT" ||
      e.type === "COPY_PASTE" ||
      e.type === "SECONDARY_CAMERA_MOVED" ||
      e.type === "SECONDARY_NO_FACE" ||
      e.type === "SECONDARY_MULTIPLE_FACES" ||
      e.type === "SECONDARY_LOOKING_AT_DEVICE" ||
      (e.type === "WINDOW_SWITCH" && m?.kind === "blur")
    );
  });

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            Interview Integrity
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Browser focus / paste and secondary-camera environment signals —
            indicators for human review, not proof of cheating. Does not change
            AI scores or hiring stage. OS applications cannot be detected from a
            normal browser.
          </p>
        </div>
        <Badge variant="secondary">Integrity mode: {mode}</Badge>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Warnings</dt>
          <dd className="font-medium text-foreground">{warnings}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Termination</dt>
          <dd className="font-medium text-foreground">
            {terminated ? "Yes" : "No"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium text-foreground">
            {terminated
              ? terminationReasonLabel(terminatedReason)
              : status}
          </dd>
        </div>
      </dl>

      {signalEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No integrity signals recorded.</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
          {signalEvents.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap gap-2 border-t border-border pt-2 text-foreground/90"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {formatDateTime(e.timestamp)}
              </span>
              <span>
                {integritySignalLabel({
                  type: e.type,
                  meta: metaObj(e.meta),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
