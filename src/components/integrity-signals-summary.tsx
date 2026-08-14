"use client";

import { useState } from "react";
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

function isTabSwitch(e: EventRow): boolean {
  if (e.type === "TAB_BLUR") return true;
  if (e.type === "WINDOW_SWITCH") {
    return metaObj(e.meta)?.kind === "blur";
  }
  return false;
}

export function IntegritySignalsSummary({
  integrityMode,
  status,
  terminatedReason,
  events,
}: {
  integrityMode: string;
  status: string;
  terminatedReason: string | null;
  events: EventRow[];
}) {
  const [techOpen, setTechOpen] = useState(false);
  const mode = parseIntegrityMode(integrityMode);
  const terminated = status === "TERMINATED";

  const tabSwitches = events.filter(isTabSwitch).length;
  const pasteEvents = events.filter((e) => e.type === "COPY_PASTE").length;
  const cameraInterruptions = events.filter(
    (e) =>
      e.type === "SECONDARY_CAMERA_DISCONNECTED" ||
      e.type === "SECONDARY_CAMERA_MOVED",
  ).length;
  const connectionInterruptions = events.filter(
    (e) => e.type === "SECONDARY_CAMERA_DISCONNECTED",
  ).length;
  const visibilityInterruptions = events.filter(
    (e) =>
      e.type === "SECONDARY_NO_FACE" ||
      e.type === "SECONDARY_MULTIPLE_FACES" ||
      e.type === "SECONDARY_LOOKING_AT_DEVICE" ||
      e.type === "SECONDARY_PERSON_MOVED" ||
      e.type === "SECONDARY_ATTENTION_DEVIATION" ||
      e.type === "SECONDARY_DEVICE_VISIBLE" ||
      e.type === "SECONDARY_DEVICE_INTERACTION",
  ).length;
  const attentionDeviations = events.filter(
    (e) => e.type === "SECONDARY_ATTENTION_DEVIATION",
  ).length;
  const additionalDevices = events.filter(
    (e) =>
      e.type === "SECONDARY_DEVICE_VISIBLE" ||
      e.type === "SECONDARY_DEVICE_INTERACTION",
  ).length;
  const additionalPersons = events.filter(
    (e) =>
      e.type === "SECONDARY_MULTIPLE_PERSONS" ||
      e.type === "SECONDARY_MULTIPLE_FACES",
  ).length;
  const personInteractions = events.filter(
    (e) => e.type === "SECONDARY_PERSON_INTERACTION",
  ).length;

  const meaningful =
    tabSwitches +
      pasteEvents +
      cameraInterruptions +
      visibilityInterruptions +
      additionalPersons +
      personInteractions >
    0;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            Integrity Signals
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Observations for human review. They are not proof of cheating and
            do not change AI scores or hiring stage.
          </p>
        </div>
        <Badge variant="secondary">
          {meaningful ? "Review recommended" : `Integrity mode: ${mode}`}
        </Badge>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Count label="Tab switches" value={tabSwitches} />
        <Count label="Copy/paste events" value={pasteEvents} />
        <Count label="Camera interruptions" value={cameraInterruptions} />
        <Count
          label="Connection interruptions"
          value={connectionInterruptions}
        />
        <Count
          label="Candidate visibility interruptions"
          value={visibilityInterruptions}
        />
        <Count label="Attention deviations" value={attentionDeviations} />
        <Count label="Additional device signals" value={additionalDevices} />
        <Count label="Additional persons" value={additionalPersons} />
        <Count label="Person interaction signals" value={personInteractions} />
        <Count
          label="Interview ended by integrity policy"
          value={terminated ? 1 : 0}
        />
      </dl>

      {terminated ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-foreground">
          Integrity signal detected — {terminationReasonLabel(terminatedReason)}.
          Recruiter review recommended.
        </p>
      ) : meaningful ? (
        <p className="text-sm text-muted-foreground">
          Review recommended. These are signals, not a cheating decision.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No integrity signals recorded.
        </p>
      )}

      <div>
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground underline"
          onClick={() => setTechOpen((v) => !v)}
        >
          {techOpen ? "Hide technical details" : "Technical details"}
        </button>
        {techOpen ? (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {events.length === 0 ? (
              <li>No stored events.</li>
            ) : (
              events.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-2">
                  <span className="font-mono">{formatDateTime(e.timestamp)}</span>
                  <span>{e.type}</span>
                  <span>
                    {integritySignalLabel({
                      type: e.type,
                      meta: metaObj(e.meta),
                    })}
                  </span>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
