/**
 * On-device secondary-camera environment signals (phone).
 * Camera motion, missing person, extra person, looking at this device.
 * Never sent to LLM prompts. Server decides TERMINATED.
 */

import type { SecondaryIntegrityKind } from "@/lib/integrity";

export type SecondaryIntegrityResult = {
  ok?: boolean;
  terminated?: boolean;
  status?: string;
  showWarning?: boolean;
  warningNumber?: number;
  warningOf?: number;
  reason?: string | null;
  kind?: SecondaryIntegrityKind;
};

type FaceBox = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

const SAMPLE_MS = 400;
const WARMUP_MS = 4_000;
const NO_FACE_MS = 7_000;
const EXTRA_FACE_MS = 2_500;
const LOOKING_MS = 3_500;
const CAMERA_MOVE_HOLD_MS = 1_200;
const LOOK_HEIGHT_RATIO = 0.42;
const GRID_COLS = 8;
const GRID_ROWS = 5;
const MOVE_CELL = 18;
const MOVE_MEAN = 14;
const MOVE_CELL_RATIO = 0.7;

function newEpisodeId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cellLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(GRID_COLS * GRID_ROWS);
  const cw = Math.max(1, Math.floor(width / GRID_COLS));
  const ch = Math.max(1, Math.floor(height / GRID_ROWS));
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      let sum = 0;
      let n = 0;
      const x0 = col * cw;
      const y0 = row * ch;
      const x1 = Math.min(width, x0 + cw);
      const y1 = Math.min(height, y0 + ch);
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          n += 1;
        }
      }
      out[row * GRID_COLS + col] = n ? sum / n : 0;
    }
  }
  return out;
}

function isGlobalCameraMove(prev: Float32Array, next: Float32Array): boolean {
  let sum = 0;
  let hot = 0;
  const n = prev.length;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(next[i] - prev[i]);
    sum += d;
    if (d >= MOVE_CELL) hot += 1;
  }
  return sum / n >= MOVE_MEAN && hot / n >= MOVE_CELL_RATIO;
}

export function createSecondaryIntegrityMonitor(params: {
  code: string;
  video: HTMLVideoElement;
  onResult: (result: SecondaryIntegrityResult) => void;
}): { start: () => void; stop: () => void } {
  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let faceDetector: {
    detectForVideo: (
      video: HTMLVideoElement,
      ts: number,
    ) => { detections: Array<{ boundingBox?: FaceBox }> };
  } | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let prevGrid: Float32Array | null = null;
  let noFaceSince: number | null = null;
  let extraSince: number | null = null;
  let lookingSince: number | null = null;
  let moveSince: number | null = null;
  let posting = false;
  let warmupUntil = 0;
  const sampleCanvasW = 160;

  async function post(kind: SecondaryIntegrityKind, faceCount?: number) {
    if (posting) return;
    posting = true;
    try {
      const res = await fetch(`/api/interview/secondary/${params.code}/integrity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          timestamp: new Date().toISOString(),
          episodeId: newEpisodeId(kind),
          ...(faceCount != null ? { faceCount } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as SecondaryIntegrityResult;
      params.onResult({ ...data, kind });
    } catch {
      /* network blip — next sample may retry */
    } finally {
      posting = false;
    }
  }

  async function sample() {
    const video = params.video;
    if (!started || video.readyState < 2 || video.videoWidth < 8) return;
    const now = Date.now();
    if (now < warmupUntil) return;

    try {
      if (!canvas) canvas = document.createElement("canvas");
      const scale = Math.min(1, sampleCanvasW / video.videoWidth);
      const w = Math.max(8, Math.round(video.videoWidth * scale));
      const h = Math.max(8, Math.round(video.videoHeight * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        const grid = cellLuma(ctx.getImageData(0, 0, w, h).data, w, h);
        if (prevGrid && isGlobalCameraMove(prevGrid, grid)) {
          if (moveSince == null) moveSince = now;
          if (now - moveSince >= CAMERA_MOVE_HOLD_MS) {
            moveSince = null;
            prevGrid = grid;
            await post("CAMERA_MOVED");
            return;
          }
        } else {
          moveSince = null;
        }
        prevGrid = grid;
      }
    } catch {
      /* motion sample best-effort */
    }

    if (!faceDetector) return;
    try {
      const result = faceDetector.detectForVideo(video, performance.now());
      const detections = result.detections ?? [];
      const n = detections.length;

      if (n === 0) {
        extraSince = null;
        lookingSince = null;
        if (noFaceSince == null) noFaceSince = now;
        if (now - noFaceSince >= NO_FACE_MS) {
          noFaceSince = now + 60_000;
          await post("PERSON_MISSING", 0);
        }
        return;
      }

      noFaceSince = null;

      if (n > 1) {
        lookingSince = null;
        if (extraSince == null) extraSince = now;
        if (now - extraSince >= EXTRA_FACE_MS) {
          extraSince = now + 60_000;
          await post("EXTRA_PERSON", n);
        }
        return;
      }

      extraSince = null;
      const box = detections[0]?.boundingBox;
      const close =
        box && video.videoHeight > 0
          ? box.height / video.videoHeight >= LOOK_HEIGHT_RATIO
          : false;
      if (close) {
        if (lookingSince == null) lookingSince = now;
        if (now - lookingSince >= LOOKING_MS) {
          lookingSince = now + 60_000;
          await post("LOOKING_AT_SECONDARY", 1);
        }
      } else {
        lookingSince = null;
      }
    } catch {
      /* face sample best-effort */
    }
  }

  async function start() {
    if (started) return;
    started = true;
    warmupUntil = Date.now() + WARMUP_MS;
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const { FaceDetector, FilesetResolver } = vision;
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      faceDetector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "/mediapipe/models/blaze_face_short_range.tflite",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
      });
    } catch {
      faceDetector = null;
    }
    timer = setInterval(() => {
      void sample();
    }, SAMPLE_MS);
  }

  function stop() {
    started = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    faceDetector = null;
    canvas = null;
    prevGrid = null;
  }

  return { start, stop };
}
