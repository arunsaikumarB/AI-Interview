/**
 * Browser-side proctoring SIGNAL collectors.
 * Never uploads camera frames or paste content — only typed events + meta.
 * Does not affect AI scores (never sent to LLM prompts).
 */

export type ProctoringClientType =
  | "TAB_BLUR"
  | "TAB_FOCUS"
  | "WINDOW_SWITCH"
  | "FULLSCREEN_EXIT"
  | "COPY_PASTE"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "OTHER";

export type ProctoringClientEvent = {
  type: ProctoringClientType;
  timestamp: string; // ISO
  meta?: Record<string, unknown>;
};

type FaceState = "ok" | "no_face" | "multiple" | "unknown";

export type ProctoringCollector = {
  start: () => void;
  stop: () => void;
  flush: () => Promise<void>;
  /** Attach paste listener to the active answer textarea. */
  watchPasteTarget: (el: HTMLElement | null) => void;
  /** Optional camera stream for face signals (local frames only). */
  enableCamera: (stream: MediaStream) => Promise<void>;
  disableCamera: () => void;
  /** Mic/camera track ended or similar — meta only, never audio. */
  noteOther: (meta: Record<string, unknown>) => void;
};

const BATCH_MS = 10_000;
const MAX_BATCH = 50;
const NO_FACE_MS = 5_000;
const FACE_SAMPLE_MS = 3_000;

export function createProctoringCollector(params: {
  token: string;
  cameraAllowed: boolean;
  /** Client-only hook (e.g. focus nudge). Does not change server payloads. */
  onEvent?: (
    type: ProctoringClientType,
    meta?: Record<string, unknown>,
  ) => void;
}): ProctoringCollector {
  const queue: ProctoringClientEvent[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let pasteEl: HTMLElement | null = null;
  let faceTimer: ReturnType<typeof setInterval> | null = null;
  let faceState: FaceState = "unknown";
  let noFaceSince: number | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let faceDetector: {
    detectForVideo: (
      video: HTMLVideoElement,
      ts: number,
    ) => { detections: unknown[] };
  } | null = null;
  const emit = (
    type: ProctoringClientType,
    meta?: Record<string, unknown>,
  ) => {
    queue.push({
      type,
      timestamp: new Date().toISOString(),
      meta: meta ?? {},
    });
    try {
      params.onEvent?.(type, meta);
    } catch {
      /* never break collectors for UI hooks */
    }
    if (queue.length >= MAX_BATCH) {
      void flush();
    }
  };

  const onVisibility = () => {
    if (document.hidden) emit("TAB_BLUR");
    else emit("TAB_FOCUS");
  };

  const onWinBlur = () => emit("WINDOW_SWITCH", { kind: "blur" });
  const onWinFocus = () => emit("WINDOW_SWITCH", { kind: "focus" });

  const onFullscreen = () => {
    if (!document.fullscreenElement) {
      emit("FULLSCREEN_EXIT");
    }
  };

  const onPaste = (e: Event) => {
    const pe = e as ClipboardEvent;
    const text = pe.clipboardData?.getData("text") ?? "";
    emit("COPY_PASTE", { pastedLength: text.length });
  };

  const onDeviceChange = () => {
    emit("OTHER", { kind: "devicechange" });
  };

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH);
    try {
      await fetch(`/api/interview/${params.token}/proctoring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
    } catch {
      // Re-queue failed batch (best-effort)
      queue.unshift(...batch);
    }
  }

  function beaconFlush() {
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH);
    const blob = new Blob([JSON.stringify({ events: batch })], {
      type: "application/json",
    });
    navigator.sendBeacon?.(
      `/api/interview/${params.token}/proctoring`,
      blob,
    );
  }

  async function sampleFaces() {
    if (!faceDetector || !videoEl || videoEl.readyState < 2) return;
    try {
      const result = faceDetector.detectForVideo(
        videoEl,
        performance.now(),
      );
      const n = result.detections?.length ?? 0;
      const now = Date.now();

      if (n === 0) {
        if (noFaceSince == null) noFaceSince = now;
        if (
          now - noFaceSince >= NO_FACE_MS &&
          faceState !== "no_face"
        ) {
          faceState = "no_face";
          emit("NO_FACE", { sustainedMs: now - noFaceSince });
        }
      } else if (n > 1) {
        noFaceSince = null;
        if (faceState !== "multiple") {
          faceState = "multiple";
          emit("MULTIPLE_FACES", { faceCount: n });
        }
      } else {
        noFaceSince = null;
        faceState = "ok";
      }
    } catch (err) {
      emit("OTHER", {
        kind: "face_sample_error",
        error: err instanceof Error ? err.name : "unknown",
      });
    }
  }

  async function enableCamera(stream: MediaStream) {
    if (!params.cameraAllowed) return;
    videoEl = document.createElement("video");
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => undefined);

    try {
      const vision = await import("@mediapipe/tasks-vision");
      const { FaceDetector, FilesetResolver } = vision;
      // Vendored via `npm run setup:mediapipe` → /public/mediapipe (no CDN)
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      faceDetector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "/mediapipe/models/blaze_face_short_range.tflite",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
      });
      faceTimer = setInterval(() => {
        void sampleFaces();
      }, FACE_SAMPLE_MS);
    } catch (err) {
      emit("OTHER", {
        kind: "face_detector_unavailable",
        error: err instanceof Error ? err.message : "load_failed",
      });
    }

    stream.getTracks().forEach((t) => {
      t.addEventListener("ended", () => {
        emit("OTHER", { kind: "camera_track_ended" });
      });
    });
  }

  function disableCamera() {
    if (faceTimer) {
      clearInterval(faceTimer);
      faceTimer = null;
    }
    faceDetector = null;
    if (videoEl) {
      videoEl.pause();
      videoEl.srcObject = null;
      videoEl = null;
    }
    faceState = "unknown";
    noFaceSince = null;
  }

  function watchPasteTarget(el: HTMLElement | null) {
    if (pasteEl) pasteEl.removeEventListener("paste", onPaste);
    pasteEl = el;
    if (pasteEl && started) pasteEl.addEventListener("paste", onPaste);
  }

  function start() {
    if (started) return;
    started = true;
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onWinBlur);
    window.addEventListener("focus", onWinFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      onDeviceChange,
    );
    if (pasteEl) pasteEl.addEventListener("paste", onPaste);
    timer = setInterval(() => {
      void flush();
    }, BATCH_MS);
    window.addEventListener("pagehide", beaconFlush);
    window.addEventListener("beforeunload", beaconFlush);
  }

  function stop() {
    if (!started) return;
    started = false;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onWinBlur);
    window.removeEventListener("focus", onWinFocus);
    document.removeEventListener("fullscreenchange", onFullscreen);
    navigator.mediaDevices?.removeEventListener?.(
      "devicechange",
      onDeviceChange,
    );
    if (pasteEl) pasteEl.removeEventListener("paste", onPaste);
    window.removeEventListener("pagehide", beaconFlush);
    window.removeEventListener("beforeunload", beaconFlush);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    disableCamera();
    void flush();
  }

  return {
    start,
    stop,
    flush,
    watchPasteTarget,
    enableCamera,
    disableCamera,
    noteOther: (meta) => emit("OTHER", meta),
  };
}
