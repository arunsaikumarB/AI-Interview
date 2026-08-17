"use client";

import { useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { integritySignalLabel } from "@/lib/integrity";
import { collapseConsecutiveSecondaryLinkEvents } from "@/lib/secondary-camera-signals";
import {
  recordingMimeHasAudio,
  recordingStatusLabel,
  recruiterRecordingState,
} from "@/lib/secondary-recording-labels";
import { SecondaryReviewPlayer } from "@/components/secondary-review-player";
import { cn } from "@/lib/utils";

type Signal = {
  id: string;
  type: string;
  timestamp: string;
  meta: unknown;
};

function formatMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—";
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function metaObj(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object") return null;
  return meta as Record<string, unknown>;
}

export function SecondaryCameraReview({
  interviewId,
  status,
  durationMs,
  interruptedMs,
  hasGap,
  hasPath,
  recordingStartedAt,
  placementConfirmed,
  secondaryDeviceStatus,
  recordingMime,
  events,
}: {
  interviewId: string;
  status: string;
  durationMs: number | null;
  interruptedMs: number;
  hasGap: boolean;
  hasPath: boolean;
  recordingStartedAt: string | null;
  placementConfirmed: boolean;
  secondaryDeviceStatus: string;
  recordingMime?: string | null;
  events: Signal[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const state = recruiterRecordingState(status, hasPath);
  const audioKnown = recordingMimeHasAudio(recordingMime);
  const visibilityCount = events.filter((e) => e.type === "SECONDARY_NO_FACE").length;
  const positionCount = events.filter(
    (e) => e.type === "SECONDARY_PERSON_MOVED",
  ).length;
  const attentionCount = events.filter(
    (e) =>
      e.type === "SECONDARY_ATTENTION_DEVIATION" ||
      e.type === "SECONDARY_LOOKING_AT_DEVICE",
  ).length;
  const deviceCount = events.filter(
    (e) =>
      e.type === "SECONDARY_DEVICE_VISIBLE" ||
      e.type === "SECONDARY_DEVICE_INTERACTION",
  ).length;
  const interruptCount =
    events.filter((e) => e.type === "SECONDARY_CAMERA_MOVED").length +
    collapseConsecutiveSecondaryLinkEvents(events).filter(
      (e) => e.type === "SECONDARY_CAMERA_DISCONNECTED",
    ).length;
  const additionalPersons = events.filter(
    (e) =>
      e.type === "SECONDARY_MULTIPLE_PERSONS" ||
      e.type === "SECONDARY_MULTIPLE_FACES",
  ).length;
  const personInteraction = events.some(
    (e) => e.type === "SECONDARY_PERSON_INTERACTION",
  );
  const playable = hasPath && state === "READY";
  const src = playable
    ? `/api/interviews/${interviewId}/secondary-recording/file`
    : null;

  const timeline = useMemo(() => {
    const start = recordingStartedAt
      ? new Date(recordingStartedAt).getTime()
      : events[0]
        ? new Date(events[0].timestamp).getTime()
        : null;
    return collapseConsecutiveSecondaryLinkEvents(events)
      .filter((e) =>
        e.type.startsWith("SECONDARY_") ||
        e.type === "TAB_BLUR" ||
        e.type === "COPY_PASTE" ||
        e.type === "FULLSCREEN_EXIT",
      )
      .map((e) => {
        const at = new Date(e.timestamp).getTime();
        const offsetMs = start != null ? Math.max(0, at - start) : null;
        return {
          id: e.id,
          type: e.type,
          label: integritySignalLabel({ type: e.type, meta: metaObj(e.meta) }),
          timestamp: e.timestamp,
          offsetMs,
        };
      });
  }, [events, recordingStartedAt]);

  function seekTo(offsetMs: number | null) {
    if (!playable || offsetMs == null || !videoRef.current) return;
    videoRef.current.currentTime = offsetMs / 1000;
    void videoRef.current.play().catch(() => undefined);
  }

  return (
    <section
      id="secondary-camera-review"
      className="space-y-4 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-foreground">
            Secondary Camera Review
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Human review artifact only — not used for AI scoring or automatic
            hiring decisions.
          </p>
        </div>
        <Badge variant="secondary">
          {playable ? "● Recording available" : recordingStatusLabel(status, hasPath)}
        </Badge>
      </div>

      {playable && src ? (
        <SecondaryReviewPlayer
          src={src}
          interviewId={interviewId}
          videoRef={videoRef}
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 text-center">
          <div>
            <p className="font-medium text-foreground">
              Secondary camera recording unavailable
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {state === "INCOMPLETE" || hasGap
                ? "Recording incomplete."
                : "Recording could not be finalized."}
            </p>
          </div>
        </div>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Recording duration</dt>
          <dd className="font-medium text-foreground">{formatMs(durationMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Video</dt>
          <dd className="font-medium text-foreground">
            {playable ? "Available" : "Not available"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Audio</dt>
          <dd className="font-medium text-foreground">
            {audioKnown === true
              ? "Available"
              : audioKnown === false
                ? "Unavailable"
                : "Not confirmed in file metadata"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Camera connection</dt>
          <dd className="font-medium text-foreground">
            {secondaryDeviceStatus === "CONNECTED"
              ? "Connected"
              : secondaryDeviceStatus === "DISCONNECTED"
                ? "Disconnected"
                : secondaryDeviceStatus === "WAITING"
                  ? "Waiting"
                  : "Not used"}
          </dd>
        </div>
      </dl>

      <div className="rounded-lg border border-border px-3 py-2 text-sm">
        <p className="font-medium text-foreground">Secondary camera placement</p>
        <p className="mt-1 text-muted-foreground">
          {placementConfirmed
            ? "Placement confirmation recorded"
            : "No placement confirmation recorded"}
        </p>
      </div>

      {hasGap || interruptedMs > 0 ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-foreground">
          Recording incomplete
          {interruptedMs > 0 ? ` (${formatMs(interruptedMs)} interrupted).` : "."}{" "}
          This is not a cheating decision.
        </p>
      ) : null}

      {timeline.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Integrity timeline</p>
          <p className="text-xs text-muted-foreground">
            {playable
              ? "Select Watch event to jump to that moment. Signals are indicators for human review, not proof of cheating."
              : "Timestamps are shown. Seeking is unavailable because there is no playable recording."}
          </p>
          <ol className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {timeline.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!playable || item.offsetMs == null}
                  onClick={() => seekTo(item.offsetMs)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left",
                    playable
                      ? "hover:bg-white/5"
                      : "cursor-default opacity-80",
                  )}
                >
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                    {formatMs(item.offsetMs)}
                  </span>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="flex-1 text-foreground">{item.label}</span>
                  {playable && item.offsetMs != null ? (
                    <span className="shrink-0 text-xs font-medium text-primary">
                      Watch event
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Candidate visibility</dt>
          <dd className="font-medium text-foreground">
            {visibilityCount === 0 ? "Good" : `${visibilityCount} interruption(s)`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Position stability</dt>
          <dd className="font-medium text-foreground">
            {positionCount === 0 ? "Good" : `Warning · ${positionCount}`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Attention deviation</dt>
          <dd className="font-medium text-foreground">{attentionCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Additional device</dt>
          <dd className="font-medium text-foreground">{deviceCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Additional persons</dt>
          <dd className="font-medium text-foreground">{additionalPersons}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Person interaction</dt>
          <dd className="font-medium text-foreground">
            {personInteraction ? "Review recommended" : "None"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Camera interruptions</dt>
          <dd className="font-medium text-foreground">{interruptCount}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Human review: the signals above are indicators. They are not automatic
        proof of cheating. The recruiter remains the final decision-maker.
      </p>
    </section>
  );
}
