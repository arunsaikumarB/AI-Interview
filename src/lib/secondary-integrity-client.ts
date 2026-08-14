/**
 * On-device secondary-camera environment signals (phone).
 * Pose + sampled object detection. Never sent to LLM prompts.
 */

import type { SecondaryIntegrityKind } from "@/lib/integrity";
import {
  ATTENTION_MS,
  CAMERA_MOVE_HOLD_MS,
  DEVICE_GONE_MS,
  DEVICE_MS,
  EVENT_COOLDOWN_MS,
  EXTRA_PERSON_GONE_MS,
  EXTRA_PERSON_MS,
  INTERACTION_MS,
  LOOK_AREA_RATIO,
  LOOKING_MS,
  MIN_PERSON_BOX_AREA,
  PERSON_INTERACTION_MS,
  PERSON_MISSING_MS,
  PERSON_MOVED_MS,
  WARMUP_MS,
  attentionDeviated,
  captureBaseline,
  extraPersonsInPrimaryZone,
  headTowardBox,
  isOutOfPosition,
  largestLaptopBox,
  mergePersonBoxes,
  personBoxesFromDetections,
  poseMetrics,
  poseToBox,
  poseVisible,
  primaryZoneFromBaseline,
  type PoseBaseline,
  type NormBox,
  unexpectedPhones,
  wristNearBox,
} from "@/lib/secondary-integrity-cv";

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

type PoseLandmarks = Array<{ x: number; y: number; visibility?: number }>;

const SAMPLE_MS = 400;
const OBJECT_EVERY_N = 2;
const SCENE_EMPTY_VARIANCE = 90;
const SCENE_DARK_MEAN = 16;
const GRID_COLS = 8;
const GRID_ROWS = 5;
const MOVE_CELL = 18;
const MOVE_MEAN = 14;
const MOVE_CELL_RATIO = 0.7;
const NO_SCENE_MS = 12_000;

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

function pixelBoxToNorm(
  box: FaceBox,
  frameW: number,
  frameH: number,
): NormBox {
  return {
    originX: box.originX / frameW,
    originY: box.originY / frameH,
    width: box.width / frameW,
    height: box.height / frameH,
  };
}

export type SecondaryFramingStatus = {
  candidateVisible: boolean;
  extraPersonInPrimaryZone: boolean;
  laptopVisible: boolean;
  personCount: number;
};

export function createSecondaryIntegrityMonitor(params: {
  code: string;
  video: HTMLVideoElement;
  isPaused?: () => boolean;
  emitEvents?: () => boolean;
  onFraming?: (status: SecondaryFramingStatus) => void;
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
  let poseLandmarker: {
    detectForVideo: (
      video: HTMLVideoElement,
      ts: number,
    ) => { landmarks?: PoseLandmarks[] };
  } | null = null;
  let objectDetector: {
    detectForVideo: (
      video: HTMLVideoElement,
      ts: number,
    ) => {
      detections: Array<{
        boundingBox?: FaceBox;
        categories?: Array<{ categoryName?: string; score?: number }>;
      }>;
    };
  } | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let prevGrid: Float32Array | null = null;
  let emptySceneSince: number | null = null;
  let extraSince: number | null = null;
  let extraGoneSince: number | null = null;
  let extraConfirmed = false;
  let extraConfirmedAt = 0;
  let personInteractSince: number | null = null;
  let lastExtras: NormBox[] = [];
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let audioBuf: Uint8Array | null = null;
  let lookingSince: number | null = null;
  let moveSince: number | null = null;
  let missingSince: number | null = null;
  let movedSince: number | null = null;
  let attentionSince: number | null = null;
  let deviceSince: number | null = null;
  let deviceGoneSince: number | null = null;
  let interactionSince: number | null = null;
  let personWasMissing = false;
  let deviceWasVisible = false;
  let posting = false;
  let warmupUntil = 0;
  let objectTick = 0;
  let lastObjectAt = 0;
  const lastPostedAt: Partial<Record<SecondaryIntegrityKind, number>> = {};
  const poseSamples: PoseBaseline[] = [];
  let baseline: PoseBaseline | null = null;
  let laptopBaseline: NormBox | null = null;
  const sampleCanvasW = 160;

  function audioLikelyActive(): boolean {
    try {
      const stream = params.video.srcObject;
      if (!(stream instanceof MediaStream) || stream.getAudioTracks().length === 0) {
        return false;
      }
      if (!analyser) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AC) return false;
        audioCtx = new AC();
        const src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        audioBuf = new Uint8Array(analyser.fftSize);
      }
      if (!analyser || !audioBuf) return false;
          analyser.getByteTimeDomainData(audioBuf as Uint8Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < audioBuf.length; i++) {
        const v = (audioBuf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / audioBuf.length) > 0.06;
    } catch {
      return false;
    }
  }

  async function post(kind: SecondaryIntegrityKind, extra?: Record<string, unknown>) {
    if (params.emitEvents && !params.emitEvents()) return;
    const now = Date.now();
    const last = lastPostedAt[kind] ?? 0;
    if (now - last < EVENT_COOLDOWN_MS) return;
    if (posting) return;
    posting = true;
    lastPostedAt[kind] = now;
    try {
      const res = await fetch(`/api/interview/secondary/${params.code}/integrity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          timestamp: new Date().toISOString(),
          episodeId: newEpisodeId(kind),
          ...extra,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as SecondaryIntegrityResult;
      params.onResult({ ...data, kind });
    } catch {
      lastPostedAt[kind] = last;
    } finally {
      posting = false;
    }
  }

  async function sample() {
    const video = params.video;
    if (!started || video.readyState < 2 || video.videoWidth < 8) return;
    if (params.isPaused?.()) return;
    const now = Date.now();
    const inWarmup = now < warmupUntil;
    const frameW = video.videoWidth;
    const frameH = video.videoHeight;

    try {
      if (!canvas) canvas = document.createElement("canvas");
      const scale = Math.min(1, sampleCanvasW / video.videoWidth);
      const w = Math.max(8, Math.round(video.videoWidth * scale));
      const h = Math.max(8, Math.round(video.videoHeight * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx && !inWarmup) {
        ctx.drawImage(video, 0, 0, w, h);
        const pixels = ctx.getImageData(0, 0, w, h).data;
        if (sceneOccupied(pixels)) {
          emptySceneSince = null;
        } else {
          if (emptySceneSince == null) emptySceneSince = now;
          if (now - emptySceneSince >= NO_SCENE_MS) {
            emptySceneSince = now + 60_000;
            await post("PERSON_MISSING", { faceCount: 0 });
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

    let poseCount = 0;
    let metrics: ReturnType<typeof poseMetrics> = null;
    const poseBoxes: NormBox[] = [];
    if (poseLandmarker) {
      try {
        const pose = poseLandmarker.detectForVideo(video, performance.now());
        const people = (pose.landmarks ?? []).filter((lm) => poseVisible(lm));
        poseCount = people.length;
        metrics = people[0] ? poseMetrics(people[0]) : null;
        for (const lm of people) {
          const box = poseToBox(lm);
          if (box) poseBoxes.push(box);
        }
      } catch {
        /* pose best-effort */
      }
    }

    objectTick += 1;
    let phones: NormBox[] = [];
    let detectedPeople: NormBox[] = [];
    if (objectDetector && objectTick % OBJECT_EVERY_N === 0) {
      try {
        const od = objectDetector.detectForVideo(video, performance.now());
        lastObjectAt = now;
        const dets = (od.detections ?? [])
          .map((d) => {
            const cat = d.categories?.[0];
            if (!d.boundingBox || !cat?.categoryName) return null;
            return {
              label: cat.categoryName,
              score: cat.score ?? 0,
              box: pixelBoxToNorm(d.boundingBox, frameW, frameH),
            };
          })
          .filter((x): x is NonNullable<typeof x> => x != null);
        if (!laptopBaseline) {
          laptopBaseline = largestLaptopBox(dets);
        }
        phones = unexpectedPhones(dets, laptopBaseline);
        detectedPeople = personBoxesFromDetections(dets);
      } catch {
        /* object detect best-effort */
      }
    }

    const zone = primaryZoneFromBaseline(baseline);
    const mergedPeople = mergePersonBoxes([...poseBoxes, ...detectedPeople]);
    const classified = extraPersonsInPrimaryZone(mergedPeople, zone);
    lastExtras = classified.extras;
    const extraInZone = classified.extras.length > 0;
    const personCount = Math.max(
      poseCount,
      mergedPeople.length,
      (classified.candidate ? 1 : 0) + classified.extras.length,
    );
    params.onFraming?.({
      candidateVisible: Boolean(metrics || classified.candidate),
      extraPersonInPrimaryZone: extraInZone,
      laptopVisible: Boolean(laptopBaseline),
      personCount,
    });

    if (inWarmup) {
      if (metrics) {
        poseSamples.push({
          hipY: metrics.hipY,
          torsoY: metrics.torsoY,
          torsoX: metrics.torsoX,
          shoulderSpan: metrics.shoulderSpan,
          noseX: metrics.noseX,
        });
      }
      return;
    }

    if (!baseline && poseSamples.length >= 5) {
      baseline = captureBaseline(poseSamples);
    }

    if (poseLandmarker) {
      if (poseCount === 0 && !metrics && !classified.candidate) {
        if (missingSince == null) missingSince = now;
        if (now - missingSince >= PERSON_MISSING_MS) {
          personWasMissing = true;
          missingSince = now + 60_000;
          await post("PERSON_MISSING", { faceCount: 0 });
        }
      } else {
        if (personWasMissing) {
          personWasMissing = false;
          missingSince = null;
          await post("PERSON_RETURNED");
        } else {
          missingSince = null;
        }
      }

      if (metrics && baseline) {
        const current: PoseBaseline = {
          hipY: metrics.hipY,
          torsoY: metrics.torsoY,
          torsoX: metrics.torsoX,
          shoulderSpan: metrics.shoulderSpan,
          noseX: metrics.noseX,
        };
        if (isOutOfPosition(current, baseline)) {
          if (movedSince == null) movedSince = now;
          if (now - movedSince >= PERSON_MOVED_MS) {
            movedSince = now + 60_000;
            await post("PERSON_MOVED");
          }
        } else {
          movedSince = null;
        }

        if (attentionDeviated(metrics.noseX, baseline.noseX, metrics.torsoX)) {
          if (attentionSince == null) attentionSince = now;
          if (now - attentionSince >= ATTENTION_MS) {
            attentionSince = now + 60_000;
            await post("ATTENTION_DEVIATION");
          }
        } else {
          attentionSince = null;
        }
      }
    }

    if (extraInZone) {
      extraGoneSince = null;
      if (extraSince == null) extraSince = now;
      if (!extraConfirmed && extraSince != null && now - extraSince >= EXTRA_PERSON_MS) {
        extraConfirmed = true;
        extraConfirmedAt = extraSince;
        await post("EXTRA_PERSON", {
          faceCount: personCount,
          personCount,
        });
      }
      const extraBox = lastExtras[0];
      const toward =
        Boolean(metrics && extraBox && headTowardBox(metrics.noseX, metrics.noseY, extraBox));
      const gesture =
        Boolean(
          metrics &&
            extraBox &&
            (wristNearBox(metrics.leftWrist, extraBox) ||
              wristNearBox(metrics.rightWrist, extraBox)),
        );
      const talking = audioLikelyActive();
      const attentionOff =
        Boolean(
          metrics &&
            baseline &&
            attentionDeviated(metrics.noseX, baseline.noseX, metrics.torsoX),
        );
      const combined =
        extraConfirmed && toward && (gesture || talking || attentionOff);
      if (combined) {
        if (personInteractSince == null) personInteractSince = now;
        if (now - personInteractSince >= PERSON_INTERACTION_MS) {
          personInteractSince = now + 60_000;
          await post("PERSON_INTERACTION", { personCount });
        }
      } else {
        personInteractSince = null;
      }
    } else {
      extraSince = null;
      personInteractSince = null;
      if (extraConfirmed) {
        if (extraGoneSince == null) extraGoneSince = now;
        if (now - extraGoneSince >= EXTRA_PERSON_GONE_MS) {
          const durationMs = extraConfirmedAt
            ? now - extraConfirmedAt
            : EXTRA_PERSON_MS;
          extraConfirmed = false;
          extraConfirmedAt = 0;
          extraGoneSince = null;
          await post("PERSON_RETURNED_TO_ONE", {
            personCount: 1,
            durationMs,
          });
        }
      }
    }

    if (phones.length > 0) {
      deviceGoneSince = null;
      if (deviceSince == null) deviceSince = now;
      if (now - deviceSince >= DEVICE_MS) {
        deviceWasVisible = true;
        deviceSince = now + 60_000;
        await post("DEVICE_VISIBLE");
      }
      const phone = phones[0]!;
      const interacting =
        Boolean(
          metrics &&
            (wristNearBox(metrics.leftWrist, phone) ||
              wristNearBox(metrics.rightWrist, phone) ||
              headTowardBox(metrics.noseX, metrics.noseY, phone)),
        );
      if (interacting) {
        if (interactionSince == null) interactionSince = now;
        if (now - interactionSince >= INTERACTION_MS) {
          interactionSince = now + 60_000;
          await post("DEVICE_INTERACTION");
        }
      } else {
        interactionSince = null;
      }
    } else if (lastObjectAt > 0 && now - lastObjectAt < 2_000) {
      deviceSince = null;
      interactionSince = null;
      if (deviceWasVisible) {
        if (deviceGoneSince == null) deviceGoneSince = now;
        if (now - deviceGoneSince >= DEVICE_GONE_MS) {
          deviceWasVisible = false;
          deviceGoneSince = null;
          await post("DEVICE_REMOVED");
        }
      }
    }

    if (!faceDetector) return;
    try {
      const result = faceDetector.detectForVideo(video, performance.now());
      const detections = result.detections ?? [];
      const people = detections.filter(
        (d) => boxAreaRatio(d.boundingBox, frameW, frameH) >= MIN_PERSON_BOX_AREA,
      );
      const largest = people.reduce((best, d) => {
        const a = boxAreaRatio(d.boundingBox, frameW, frameH);
        return a > best ? a : best;
      }, 0);
      if (largest >= LOOK_AREA_RATIO) {
        if (lookingSince == null) lookingSince = now;
        if (now - lookingSince >= LOOKING_MS) {
          lookingSince = now + 60_000;
          await post("LOOKING_AT_SECONDARY", { faceCount: 1 });
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
      const {
        FaceDetector,
        FilesetResolver,
        PoseLandmarker,
        ObjectDetector,
      } = vision;
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      try {
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
      try {
        poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: "/mediapipe/models/pose_landmarker_lite.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numPoses: 3,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch {
        poseLandmarker = null;
      }
      try {
        objectDetector = await ObjectDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: "/mediapipe/models/efficientdet_lite0.tflite",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          scoreThreshold: 0.4,
          maxResults: 12,
        });
      } catch {
        objectDetector = null;
      }
    } catch {
      faceDetector = null;
      poseLandmarker = null;
      objectDetector = null;
    }
    timer = setInterval(() => {
      void sample();
    }, SAMPLE_MS);
  }

  function resume() {
    warmupUntil = Date.now() + Math.min(WARMUP_MS, 2_500);
    emptySceneSince = null;
    extraSince = null;
    extraGoneSince = null;
    extraConfirmed = false;
    extraConfirmedAt = 0;
    personInteractSince = null;
    lookingSince = null;
    moveSince = null;
    missingSince = null;
    movedSince = null;
    attentionSince = null;
    deviceSince = null;
    interactionSince = null;
    posting = false;
  }

  function stop() {
    started = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    faceDetector = null;
    poseLandmarker = null;
    objectDetector = null;
    canvas = null;
    prevGrid = null;
    try {
      void audioCtx?.close();
    } catch {
      /* ignore */
    }
    audioCtx = null;
    analyser = null;
    audioBuf = null;
  }

  return { start, stop, resume };
}
