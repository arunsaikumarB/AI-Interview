"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyGetUserMediaError,
  isHonestPrimaryRecordingSave,
  logPrimaryCamera,
  pickVideoDeviceId,
  primaryCameraConstraint,
  PRIMARY_CAMERA_LOG,
  resolvePreferredVideoDeviceId,
  videoTrackLive,
  type PrimaryCameraUiStatus,
  type PrimaryRecordingUiStatus,
} from "@/lib/primary-camera";
import {
  takePrimaryCameraStream,
  discardPrimaryCameraStream,
} from "@/lib/primary-camera-handoff";

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

/**
 * Stable primary camera + continuous video recording.
 * Stream lives in a ref so question/orb/timer rerenders do not recreate it.
 * Preview video.muted must never disable MediaRecorder tracks (video-only here;
 * answer mic is a separate stream).
 */
export function usePrimaryCamera(opts: {
  enabled: boolean;
  token: string;
  preferredDeviceId?: string | null;
  record: boolean;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const chunkIndexRef = useRef(0);
  const finalizedRef = useRef(false);
  const startingRef = useRef(false);
  const acquireGenRef = useRef(0);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<PrimaryCameraUiStatus>("idle");
  const [recordingStatus, setRecordingStatus] =
    useState<PrimaryRecordingUiStatus>("idle");
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const stopRecorderOnly = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    stopRecorderOnly();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    recordingIdRef.current = null;
    chunkIndexRef.current = 0;
  }, [stopRecorderOnly]);

  const uploadChunk = useCallback(
    async (blob: Blob, index: number, recordingId: string) => {
      const form = new FormData();
      form.set("recordingId", recordingId);
      form.set("chunkIndex", String(index));
      form.set("chunk", blob, `chunk-${index}.webm`);
      const res = await fetch(
        `/api/interview/${opts.token}/primary-recording/chunk`,
        { method: "POST", body: form },
      );
      if (!res.ok) {
        logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, {
          phase: "chunk_upload",
          status: res.status,
        });
      } else {
        logPrimaryCamera(PRIMARY_CAMERA_LOG.RECORDING_DATA, {
          index,
          bytes: blob.size,
        });
      }
    },
    [opts.token],
  );

  const startRecording = useCallback(
    async (media: MediaStream) => {
      if (!opts.record) return;
      if (typeof MediaRecorder === "undefined") {
        setRecordingStatus("failed");
        return;
      }
      if (recorderRef.current?.state === "recording") return;
      if (startingRef.current) return;
      startingRef.current = true;
      finalizedRef.current = false;
      setRecordingStatus("starting");
      try {
        const startRes = await fetch(
          `/api/interview/${opts.token}/primary-recording/start`,
          { method: "POST" },
        );
        if (!startRes.ok) {
          setRecordingStatus("failed");
          logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, { phase: "start_api" });
          return;
        }
        const started = (await startRes.json()) as { recordingId: string };
        recordingIdRef.current = started.recordingId;
        chunkIndexRef.current = 0;

        const mime = pickRecorderMime();
        const rec = mime
          ? new MediaRecorder(media, {
              mimeType: mime,
              videoBitsPerSecond: 1_200_000,
            })
          : new MediaRecorder(media);
        recorderRef.current = rec;
        rec.ondataavailable = (ev) => {
          if (!ev.data || ev.data.size <= 0) return;
          const id = recordingIdRef.current;
          if (!id) return;
          const index = chunkIndexRef.current++;
          void uploadChunk(ev.data, index, id);
        };
        rec.onerror = () => {
          setRecordingStatus("failed");
          logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, { phase: "recorder_error" });
        };
        rec.start(2000);
        if (rec.state !== "recording") {
          setRecordingStatus("failed");
          logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, {
            phase: "recorder_state",
            state: rec.state,
          });
          return;
        }
        setRecordingStatus("recording");
        logPrimaryCamera(PRIMARY_CAMERA_LOG.RECORDING_STARTED, {
          recordingId: started.recordingId,
          mime: rec.mimeType,
        });
      } catch (err) {
        setRecordingStatus("failed");
        logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, {
          phase: "start_recording",
          error: err instanceof Error ? err.message : "unknown",
        });
      } finally {
        startingRef.current = false;
      }
    },
    [opts.record, opts.token, uploadChunk],
  );

  const attachStream = useCallback(
    async (media: MediaStream, fromHandoff: boolean) => {
      if (streamRef.current && streamRef.current !== media) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = media;
      setStream(media);
      const id = pickVideoDeviceId(media);
      setDeviceId(id);
      setCameraStatus(videoTrackLive(media) ? "previewing" : "lost");
      logPrimaryCamera(PRIMARY_CAMERA_LOG.READY, {
        deviceId: id,
        fromHandoff,
      });

      media.getVideoTracks().forEach((t) => {
        t.addEventListener("ended", () => {
          setCameraStatus("lost");
          setRecordingStatus((s) => (s === "recording" ? "failed" : s));
          logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, { phase: "track_ended" });
        });
      });

      if (opts.record) {
        await startRecording(media);
      }
    },
    [opts.record, startRecording],
  );

  const acquire = useCallback(async () => {
    if (!opts.enabled) return;
    const gen = ++acquireGenRef.current;
    setCameraStatus("requesting");

    const handed = takePrimaryCameraStream();
    if (handed && videoTrackLive(handed.stream)) {
      if (gen !== acquireGenRef.current) {
        handed.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await attachStream(handed.stream, true);
      return;
    }
    if (handed) {
      handed.stream.getTracks().forEach((t) => t.stop());
    }

    try {
      const preferred = await resolvePreferredVideoDeviceId(opts.preferredDeviceId);
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: primaryCameraConstraint(preferred),
          audio: false,
        });
      } catch {
        media = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      if (gen !== acquireGenRef.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      await attachStream(media, false);
    } catch (err) {
      if (gen !== acquireGenRef.current) return;
      const status = classifyGetUserMediaError(err);
      setCameraStatus(status);
      setStream(null);
      streamRef.current = null;
      logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, {
        phase: "getUserMedia",
        status,
      });
    }
  }, [opts.enabled, opts.preferredDeviceId, attachStream]);

  const finalizeRecording = useCallback(async () => {
    if (finalizedRef.current) return;
    const recordingId = recordingIdRef.current;
    const rec = recorderRef.current;
    if (!recordingId) return;
    finalizedRef.current = true;
    setRecordingStatus("stopping");

    await new Promise<void>((resolve) => {
      if (!rec || rec.state === "inactive") {
        resolve();
        return;
      }
      rec.addEventListener("stop", () => resolve(), { once: true });
      try {
        if (rec.state === "recording") rec.requestData();
        rec.stop();
      } catch {
        resolve();
      }
    });
    logPrimaryCamera(PRIMARY_CAMERA_LOG.RECORDING_STOPPED, { recordingId });
    recorderRef.current = null;

    await new Promise((r) => setTimeout(r, 400));

    try {
      const res = await fetch(
        `/api/interview/${opts.token}/primary-recording/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordingId }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        byteLength?: number;
      };
      if (isHonestPrimaryRecordingSave({
        ok: res.ok ? data.ok : false,
        status: data.status,
        byteLength: data.byteLength,
      })) {
        setRecordingStatus("saved");
        logPrimaryCamera(PRIMARY_CAMERA_LOG.RECORDING_SAVED, {
          byteLength: data.byteLength,
        });
      } else {
        setRecordingStatus("failed");
        logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, {
          phase: "finalize",
          data,
        });
      }
    } catch {
      setRecordingStatus("failed");
      logPrimaryCamera(PRIMARY_CAMERA_LOG.ERROR, { phase: "finalize_network" });
    }
  }, [opts.token]);

  useEffect(() => {
    if (!opts.enabled) {
      acquireGenRef.current += 1;
      stopAll();
      setCameraStatus("idle");
      setRecordingStatus("idle");
      return;
    }
    void acquire();
    return () => {
      acquireGenRef.current += 1;
      stopRecorderOnly();
      // Keep tracks alive only while enabled; on disable/unmount release.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    };
    // Narrow deps: do not recreate on question/orb/timer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.token, opts.preferredDeviceId, opts.record]);

  const retry = useCallback(() => {
    discardPrimaryCameraStream();
    stopAll();
    finalizedRef.current = false;
    setRecordingStatus("idle");
    void acquire();
  }, [acquire, stopAll]);

  const dismissCamera = useCallback(() => {
    discardPrimaryCameraStream();
    stopAll();
    setCameraStatus("unavailable");
    setRecordingStatus("skipped");
  }, [stopAll]);

  return {
    stream,
    streamRef,
    cameraStatus,
    recordingStatus,
    deviceId,
    retry,
    dismissCamera,
    finalizeRecording,
    videoLive: videoTrackLive(stream),
  };
}
