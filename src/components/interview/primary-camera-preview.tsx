"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  logPrimaryCamera,
  PRIMARY_CAMERA_LOG,
  videoTrackLive,
  type PrimaryCameraUiStatus,
  type PrimaryRecordingUiStatus,
} from "@/lib/primary-camera";

/**
 * Right-column primary laptop camera panel.
 * Uses the real MediaStream — never a fake preview when a stream exists.
 */
export function PrimaryCameraPanel({
  stream,
  cameraStatus,
  recordingStatus,
  cameraAllowed,
  onRetry,
  onDismiss,
  className,
}: {
  stream: MediaStream | null;
  cameraStatus: PrimaryCameraUiStatus;
  recordingStatus: PrimaryRecordingUiStatus;
  cameraAllowed: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!stream || !videoTrackLive(stream)) {
      el.srcObject = null;
      return;
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    void el
      .play()
      .then(() => {
        logPrimaryCamera(PRIMARY_CAMERA_LOG.PREVIEW_STARTED, {
          readyState: el.readyState,
        });
      })
      .catch(() => {
        logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, { phase: "preview_play" });
      });
  }, [stream]);

  const live = videoTrackLive(stream);
  const recording = recordingStatus === "recording";

  let title = "Your camera";
  let detail = "Camera is optional for this interview.";
  if (!cameraAllowed || recordingStatus === "skipped") {
    title = "Camera skipped";
    detail = "You can continue the interview without video.";
  } else if (cameraStatus === "requesting" || cameraStatus === "idle") {
    title = "Starting camera…";
    detail = "Please allow camera access if prompted.";
  } else if (cameraStatus === "denied") {
    title = "Camera access is blocked";
    detail = "Enable camera access in your browser settings.";
  } else if (cameraStatus === "unavailable") {
    title = "Camera unavailable";
    detail = "You can continue the interview without video.";
  } else if (cameraStatus === "lost") {
    title = "Camera connection lost";
    detail = "Your video is no longer being recorded. Please reconnect.";
  } else if (recording) {
    title = "Recording";
    detail = "Your interview video is being recorded.";
  } else if (live) {
    title = "Camera Active";
    detail = "Your camera is ready.";
  } else if (recordingStatus === "failed") {
    title = "Recording unavailable";
    detail = "Preview may work, but video could not be saved.";
  }

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col rounded-2xl border border-white/10 bg-[#0d121c]/90 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)]",
        className,
      )}
      data-primary-camera-panel
      data-camera-status={cameraStatus}
      data-recording-status={recordingStatus}
      aria-label="Your camera"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          Your camera
        </h2>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
            Camera Active
          </span>
        ) : null}
      </div>

      <div
        className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-black"
        style={{ aspectRatio: "16 / 10" }}
      >
        {stream ? (
          <video
            ref={videoRef}
            className={cn(
              "h-full w-full object-cover",
              live ? "block" : "hidden",
            )}
            autoPlay
            muted
            playsInline
          />
        ) : null}
        {live ? null : (
          <div className="flex h-full min-h-[140px] w-full items-center justify-center px-4 text-center text-sm text-zinc-400">
            {cameraStatus === "requesting" || (cameraAllowed && cameraStatus === "idle")
              ? "Starting camera…"
              : cameraStatus === "denied"
                ? "Camera access blocked"
                : cameraStatus === "lost"
                  ? "Camera connection lost"
                  : !cameraAllowed || recordingStatus === "skipped"
                    ? "Camera skipped"
                    : "Camera unavailable"}
          </div>
        )}

        {live ? (
          <>
            <div className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white backdrop-blur">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  recording ? "bg-red-500" : "bg-emerald-400",
                )}
                aria-hidden
              />
              LIVE
            </div>
            <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-medium text-zinc-100 backdrop-blur">
              {recording ? "Recording" : "Camera Active"}
            </div>
          </>
        ) : null}
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-sm font-medium text-zinc-100">{title}</p>
        <p className="text-xs leading-relaxed text-zinc-500">{detail}</p>
      </div>

      {(cameraStatus === "lost" ||
        cameraStatus === "denied" ||
        cameraStatus === "unavailable") &&
      onRetry ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-sky-500/20 px-3 py-1.5 text-xs font-medium text-sky-100 outline-none ring-offset-background hover:bg-sky-500/30 focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            Retry camera
          </button>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 outline-none hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              Continue without camera
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** @deprecated Prefer PrimaryCameraPanel in the sidebar layout. */
export { PrimaryCameraPanel as PrimaryCameraPreview };
