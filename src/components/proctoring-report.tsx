"use client";

import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type EventRow = {
  id: string;
  type: string;
  timestamp: string;
  meta: unknown;
};

function isLossEvent(e: EventRow): boolean {
  if (e.type === "TAB_BLUR" || e.type === "FULLSCREEN_EXIT") return true;
  if (e.type === "WINDOW_SWITCH") {
    const kind =
      e.meta && typeof e.meta === "object"
        ? (e.meta as { kind?: string }).kind
        : undefined;
    return kind === "blur";
  }
  return false;
}

export function ProctoringReportSection({
  enabled,
  cameraConsent,
  events,
}: {
  enabled: boolean;
  /** Explicit stored choice — null if consent not recorded */
  cameraConsent: boolean | null;
  events: EventRow[];
}) {
  if (!enabled) return null;

  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});

  const focusLoss = events.filter(isLossEvent).length;
  const hasMultiple = (counts.MULTIPLE_FACES ?? 0) > 0;

  let level: "LOW" | "MEDIUM" | "HIGH" | null = null;
  if (events.length > 0) {
    if (hasMultiple || focusLoss >= 10) level = "HIGH";
    else if (focusLoss >= 3) level = "MEDIUM";
    else level = "LOW";
  }

  const consentLine =
    cameraConsent === true
      ? "Consent: full (incl. camera)"
      : cameraConsent === false
        ? "Consent: signals only (camera declined)"
        : "Consent: not recorded";

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            Proctoring signals
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{consentLine}</p>
        </div>
        {level ? (
          <Badge
            className={cn(
              level === "LOW" && "bg-success/15 text-success",
              level === "MEDIUM" && "bg-warning/15 text-foreground",
              level === "HIGH" && "bg-destructive/15 text-destructive",
            )}
          >
            Indicative: {level}
          </Badge>
        ) : (
          <Badge variant="secondary">No signals yet</Badge>
        )}
      </div>

      <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Indicative only — review the timeline; signals are not evidence of
        cheating.
      </p>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No proctoring events recorded for this session.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(counts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([type, n]) => (
                <Badge key={type} variant="secondary">
                  {type} · {n}
                </Badge>
              ))}
          </div>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap gap-2 border-t border-border pt-2 text-foreground/90"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDateTime(e.timestamp)}
                </span>
                <span className="font-medium">{e.type}</span>
                <span className="text-xs text-muted-foreground">
                  {formatMeta(e.meta)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function formatMeta(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const o = meta as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof o.pastedLength === "number") {
    bits.push(`pastedLength=${o.pastedLength}`);
  }
  if (typeof o.faceCount === "number") bits.push(`faces=${o.faceCount}`);
  if (typeof o.kind === "string") bits.push(o.kind);
  if (typeof o.sustainedMs === "number") bits.push(`${o.sustainedMs}ms`);
  return bits.join(" · ");
}
