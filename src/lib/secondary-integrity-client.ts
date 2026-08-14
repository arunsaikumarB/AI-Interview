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
const WARMUP_MS = 6_000;
/** Covered / black / featureless frame — not “no frontal face”. */
const NO_SCENE_MS = 12_000;
const EXTRA_FACE_MS = 8_000;
const LOOKING_MS = 4_000;
const CAMERA_MOVE_HOLD_MS = 1_600;
/**
 * Side-desk profile is the expected secondary view. BlazeFace is frontal-only,
 * so a missing face is normal. “Looking at this phone” only if a large
 * selfie-style face fills the frame.
 */
const LOOK_AREA_RATIO = 0.2;
const MIN_PERSON_BOX_AREA = 0.035;
const SCENE_EMPTY_VARIANCE = 90;
const SCENE_DARK_MEAN = 16;
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

function sceneOccupied(data: Uint8ClampedArray): boolean {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 32) {
    const y = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    sum += y;
    sum2 += y * y;
    n += 1;
  }
  if (n < 8) return true;
  const mean = sum / n;
  const variance = sum2 / n - mean * mean;
  if (mean < SCENE_DARK_MEAN) return false;
  if (variance < SCENE_EMPTY_VARIANCE) return false;
  return true;
}

function boxAreaRatio(
  box: FaceBox | undefined,
  frameW: number,
  frameH: number,
): number {
  if (!box || frameW <= 0 || frameH <= 0) return 0;
  return (box.width * box.height) / (frameW * frameH);
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
  isPaused?: () => boolean;
  onResult: (result: SecondaryIntegrityResult) => void;
}): { start: () => void; stop: () => void; resume: () => void } {
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
  let emptySceneSince: number | null = null;
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
    if (params.isPaused?.()) return;
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
        const pixels = ctx.getImageData(0, 0, w, h).data;
        if (sceneOccupied(pixels)) {
          emptySceneSince = null;
        } else {
          if (emptySceneSince == null) emptySceneSince = now;
          if (now - emptySceneSince >= NO_SCENE_MS) {
            emptySceneSince = now + 60_000;
            await post("PERSON_MISSING", 0);
            prevGrid = cellLuma(pixels, w, h);
            return;
          }
        }
        const grid = cellLuma(pixels, w, h);
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
      const frameW = video.videoWidth;
      const frameH = video.videoHeight;
      const people = detections.filter(
        (d) => boxAreaRatio(d.boundingBox, frameW, frameH) >= MIN_PERSON_BOX_AREA,
      );

      if (people.length >= 2) {
        lookingSince = null;
        if (extraSince == null) extraSince = now;
        if (now - extraSince >= EXTRA_FACE_MS) {
          extraSince = now + 60_000;
          await post("EXTRA_PERSON", people.length);
        }
        return;
      }
      extraSince = null;

      const largest = people.reduce((best, d) => {
        const a = boxAreaRatio(d.boundingBox, frameW, frameH);
        return a > best ? a : best;
      }, 0);
      // Side-profile at a desk is a small face (or none). A large face means
      // they picked up this phone and are looking into it.
      if (largest >= LOOK_AREA_RATIO) {
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

  function resume() {
    warmupUntil = Date.now() + WARMUP_MS;
    emptySceneSince = null;
    extraSince = null;
    lookingSince = null;
    moveSince = null;
    posting = false;
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

  return { start, stop, resume };
}
