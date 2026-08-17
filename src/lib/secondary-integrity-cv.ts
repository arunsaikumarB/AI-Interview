/** Pure helpers for secondary-camera CV (normalized coords, no DOM). */

export type NormBox = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type NormPoint = {
  x: number;
  y: number;
  visibility?: number;
};

export type PoseBaseline = {
  hipY: number;
  torsoY: number;
  torsoX: number;
  shoulderSpan: number;
  noseX: number;
};

export const PERSON_MISSING_MS = 1_800;
export const PERSON_MOVED_MS = 2_000;
export const ATTENTION_MS = 2_500;
export const DEVICE_MS = 1_500;
export const DEVICE_GONE_MS = 1_500;
export const INTERACTION_MS = 1_500;
export const CAMERA_MOVE_HOLD_MS = 1_600;
/** Additional person in the primary interview zone (not far background). */
export const EXTRA_PERSON_MS = 1_800;
export const EXTRA_PERSON_GONE_MS = 1_600;
export const PERSON_INTERACTION_MS = 2_000;
export const LOOKING_MS = 4_000;
export const EVENT_COOLDOWN_MS = 8_000;
export const WARMUP_MS = 6_000;
export const LOOK_AREA_RATIO = 0.2;
export const MIN_PERSON_BOX_AREA = 0.035;
export const MIN_CLOSE_PERSON_AREA = 0.035;

/* ── F-05 R1: baseline may only be taken from a settled candidate ────────── */

/** Minimum pose samples before a baseline can be considered at all. */
export const BASELINE_MIN_SAMPLES = 5;

/**
 * Maximum spread allowed across a sampling window for it to count as settled.
 * Chosen well below the isOutOfPosition thresholds (0.20 / 0.22 / 0.18) so a
 * baseline can never be taken from a window that already contains a movement
 * large enough to later be reported as one.
 */
export const BASELINE_SETTLE_TOLERANCE = 0.06;

/**
 * If the candidate never fully settles, stop waiting and take the best
 * available baseline rather than leaving the session unmonitored.
 */
export const BASELINE_MAX_WAIT_MS = 15_000;

/** How long a condition must be continuously clear before its episode ends. */
export const SECONDARY_EPISODE_CLEAR_MS = 4_000;

function spread(values: number[]): number {
  if (values.length === 0) return Infinity;
  return Math.max(...values) - Math.min(...values);
}

/**
 * True when a pose window is stable enough to define "the interview position".
 *
 * F-05: the old code took the baseline during a fixed 6s warm-up that began the
 * moment the camera came up — i.e. while the candidate was still holding and
 * propping the phone. Their settled posture was then permanently out-of-position
 * against that setup posture. Requiring stability means a window that spans the
 * setup→settle transition is rejected instead of frozen in.
 */
export function isSettled(samples: PoseBaseline[]): boolean {
  if (samples.length < BASELINE_MIN_SAMPLES) return false;
  return (
    spread(samples.map((s) => s.torsoY)) <= BASELINE_SETTLE_TOLERANCE &&
    spread(samples.map((s) => s.torsoX)) <= BASELINE_SETTLE_TOLERANCE &&
    spread(samples.map((s) => s.shoulderSpan)) <= BASELINE_SETTLE_TOLERANCE &&
    spread(samples.map((s) => s.hipY)) <= BASELINE_SETTLE_TOLERANCE
  );
}

/* ── R7: device presence continuity ──────────────────────────────────────── */

/**
 * How long a device may go undetected before presence lapses.
 *
 * Run G (real phone) produced 16 cell-phone detections whose longest
 * uninterrupted run was 1600ms, yet DEVICE_VISIBLE fired zero times: the hold
 * reset on every single missed detector frame, so the 1500ms DEVICE_MS window
 * never completed. Real phone video detects intermittently.
 *
 * 1200ms spans exactly one missed object-detection tick (detection runs every
 * 2nd 400ms sample = 800ms). Two consecutive misses exceed it, so presence
 * still lapses and DEVICE_REMOVED still fires. Deliberately shorter than
 * DEVICE_MS so it can never manufacture a hold on its own.
 */
export const DEVICE_ABSENCE_GRACE_MS = 1_200;

export type PresenceDebouncer = {
  /** Feed the raw per-frame detection result; returns debounced presence. */
  update: (raw: boolean, now: number) => boolean;
  /** Drop presence immediately (session pause / resume). */
  reset: () => void;
};

/**
 * Smooths intermittent detector output into a presence signal, bounded by
 * `graceMs`. This is NOT sticky detection: once the grace elapses with no
 * detection, presence goes false and stays false until the detector fires
 * again.
 */
export function createPresenceDebouncer(opts: {
  graceMs?: number;
}): PresenceDebouncer {
  const graceMs = opts.graceMs ?? DEVICE_ABSENCE_GRACE_MS;
  let lastSeenAt: number | null = null;

  return {
    update(raw, now) {
      if (raw) {
        lastSeenAt = now;
        return true;
      }
      if (lastSeenAt == null) return false;
      if (now - lastSeenAt >= graceMs) {
        lastSeenAt = null;
        return false;
      }
      return true;
    },
    reset() {
      lastSeenAt = null;
    },
  };
}

/* ── R8: device interaction continuity ───────────────────────────────────── */

/**
 * How long the most recently observed phone box stays usable for evaluating
 * the interaction geometry.
 *
 * sample() runs every 400ms but object detection only runs every 2nd tick, so
 * `phones` is empty on roughly half of all frames *before* any detector
 * intermittency. The interaction condition needs a box to test the wrist
 * against, so `interactionSince` was reset at least every other frame and the
 * 1500ms INTERACTION_MS hold could never accumulate — Run I fired
 * DEVICE_VISIBLE six times and DEVICE_INTERACTION zero times.
 *
 * 1200ms spans the non-detection tick plus one detector blink. It is a memory
 * of *where the phone was*, not of whether an interaction happened: the
 * wrist/head geometry is still re-evaluated on every frame against this box,
 * and the box expires once the phone is genuinely gone.
 */
export const DEVICE_BOX_MEMORY_MS = 1_200;

export type BoxMemory = {
  /** Feed this frame's box (or null); returns the box usable right now. */
  update: (box: NormBox | null, now: number) => NormBox | null;
  reset: () => void;
};

/**
 * Remembers the last observed box for a bounded window. Never fabricates a
 * box: it only replays one that the detector actually produced, and only until
 * `ttlMs` has elapsed.
 */
export function createBoxMemory(opts: { ttlMs?: number }): BoxMemory {
  const ttlMs = opts.ttlMs ?? DEVICE_BOX_MEMORY_MS;
  let box: NormBox | null = null;
  let seenAt = 0;

  return {
    update(next, now) {
      if (next) {
        box = next;
        seenAt = now;
        return box;
      }
      if (!box) return null;
      if (now - seenAt >= ttlMs) {
        box = null;
        return null;
      }
      return box;
    },
    reset() {
      box = null;
      seenAt = 0;
    },
  };
}

/* ── F-05 R2: one continuous condition is one episode ────────────────────── */

export type EpisodeUpdate = { fire: boolean; episodeId: string | null };

export type EpisodeTracker = {
  /** Feed the current condition state. Returns whether to report it now. */
  update: (active: boolean, now: number) => EpisodeUpdate;
  /** Id of the episode currently in flight, or null. */
  current: () => string | null;
  /** Abandon any in-flight episode (session pause / resume). */
  reset: () => void;
};

/**
 * Tracks one integrity condition across frames.
 *
 * F-05: the old inline pattern reset its hold timer on a single clear frame
 * (`else { movedSince = null }`), so one unbroken condition re-fired every
 * ~8s and billed a separate termination slot each time. Run C reached the
 * 4-episode limit in 37 seconds from a single bad baseline.
 *
 * Here an episode opens once the condition has held for `holdMs`, reports
 * exactly once, and stays open — keeping one stable id so the server's
 * episode de-duplication can engage — until the condition has been
 * continuously clear for `clearMs`.
 */
export function createEpisodeTracker(opts: {
  kind: string;
  holdMs: number;
  clearMs?: number;
  idFactory?: (kind: string, startedAt: number) => string;
}): EpisodeTracker {
  const clearMs = opts.clearMs ?? SECONDARY_EPISODE_CLEAR_MS;
  const makeId =
    opts.idFactory ??
    ((kind: string, startedAt: number) =>
      `${kind}-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  let activeSince: number | null = null;
  let clearSince: number | null = null;
  let episodeId: string | null = null;
  let reported = false;

  return {
    update(active, now) {
      if (active) {
        clearSince = null;
        if (activeSince == null) activeSince = now;
        if (!reported && now - activeSince >= opts.holdMs) {
          reported = true;
          episodeId = makeId(opts.kind, activeSince);
          return { fire: true, episodeId };
        }
        return { fire: false, episodeId };
      }

      // Not active. A brief flicker must NOT end the episode or re-arm the hold.
      if (clearSince == null) clearSince = now;
      if (now - clearSince >= clearMs) {
        activeSince = null;
        clearSince = null;
        episodeId = null;
        reported = false;
      }
      return { fire: false, episodeId };
    },
    current() {
      return episodeId;
    },
    reset() {
      activeSince = null;
      clearSince = null;
      episodeId = null;
      reported = false;
    },
  };
}

const PHONE_LABELS = new Set(["cell phone", "mobile phone", "phone"]);
const LAPTOP_LABELS = new Set(["laptop", "tv", "monitor", "computer"]);

export function boxIou(a: NormBox, b: NormBox): number {
  const ax2 = a.originX + a.width;
  const ay2 = a.originY + a.height;
  const bx2 = b.originX + b.width;
  const by2 = b.originY + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.originX, b.originX));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.originY, b.originY));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function isPersonLabel(name: string): boolean {
  return name.trim().toLowerCase() === "person";
}

export function isPhoneLabel(name: string): boolean {
  return PHONE_LABELS.has(name.trim().toLowerCase());
}

export function isLaptopLikeLabel(name: string): boolean {
  return LAPTOP_LABELS.has(name.trim().toLowerCase());
}

export function poseVisible(
  landmarks: NormPoint[] | undefined,
  minVis = 0.35,
): boolean {
  if (!landmarks || landmarks.length < 25) return false;
  const ids = [0, 11, 12, 23, 24];
  let n = 0;
  for (const id of ids) {
    const p = landmarks[id];
    if (p && (p.visibility ?? 1) >= minVis) n += 1;
  }
  return n >= 2;
}

function avg(
  a: NormPoint | undefined,
  b: NormPoint | undefined,
): { x: number; y: number } | null {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function poseMetrics(landmarks: NormPoint[]): {
  hipY: number;
  torsoY: number;
  torsoX: number;
  shoulderSpan: number;
  noseX: number;
  noseY: number;
  leftWrist: NormPoint | null;
  rightWrist: NormPoint | null;
} | null {
  if (!poseVisible(landmarks)) return null;
  const nose = landmarks[0];
  const ls = landmarks[11];
  const rs = landmarks[12];
  const lh = landmarks[23];
  const rh = landmarks[24];
  const shoulders = avg(ls, rs);
  const hips = avg(lh, rh);
  if (!shoulders || !hips || !nose) return null;
  return {
    hipY: hips.y,
    torsoY: (shoulders.y + hips.y) / 2,
    torsoX: (shoulders.x + hips.x) / 2,
    shoulderSpan: Math.abs((ls?.x ?? 0) - (rs?.x ?? 0)),
    noseX: nose.x,
    noseY: nose.y,
    leftWrist: landmarks[15] ?? null,
    rightWrist: landmarks[16] ?? null,
  };
}

export function captureBaseline(samples: PoseBaseline[]): PoseBaseline | null {
  if (samples.length < 5) return null;
  const pick = (fn: (s: PoseBaseline) => number) => {
    const vals = samples.map(fn).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)]!;
  };
  return {
    hipY: pick((s) => s.hipY),
    torsoY: pick((s) => s.torsoY),
    torsoX: pick((s) => s.torsoX),
    shoulderSpan: pick((s) => s.shoulderSpan),
    noseX: pick((s) => s.noseX),
  };
}

/** Standing / leaving seat: hips rise in image (smaller y) vs seated baseline. */
export function isOutOfPosition(
  current: PoseBaseline,
  baseline: PoseBaseline,
): boolean {
  const standUp = baseline.hipY - current.hipY >= 0.16;
  const leftSeat =
    Math.abs(current.torsoX - baseline.torsoX) >= 0.22 ||
    Math.abs(current.torsoY - baseline.torsoY) >= 0.2;
  const closer = current.shoulderSpan - baseline.shoulderSpan >= 0.18;
  return standUp || leftSeat || closer;
}

/** Approximate yaw from nose vs shoulder midpoint (normalized). */
export function attentionDeviated(
  noseX: number,
  baselineNoseX: number,
  torsoX: number,
): boolean {
  const vsBaseline = Math.abs(noseX - baselineNoseX) >= 0.14;
  const vsTorso = Math.abs(noseX - torsoX) >= 0.16;
  return vsBaseline && vsTorso;
}

export function wristNearBox(
  wrist: NormPoint | null,
  box: NormBox,
  pad = 0.08,
): boolean {
  if (!wrist || (wrist.visibility != null && wrist.visibility < 0.3)) {
    return false;
  }
  return (
    wrist.x >= box.originX - pad &&
    wrist.x <= box.originX + box.width + pad &&
    wrist.y >= box.originY - pad &&
    wrist.y <= box.originY + box.height + pad
  );
}

export function headTowardBox(
  noseX: number,
  noseY: number,
  box: NormBox,
): boolean {
  const cx = box.originX + box.width / 2;
  const cy = box.originY + box.height / 2;
  const dx = cx - noseX;
  const dy = cy - noseY;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.08) return true;
  return Math.abs(dx) < 0.22 && dist < 0.55;
}

export function unexpectedPhones(
  detections: Array<{ label: string; score: number; box: NormBox }>,
  laptopBaseline: NormBox | null,
): NormBox[] {
  const phones: NormBox[] = [];
  for (const d of detections) {
    if (d.score < 0.45 || !isPhoneLabel(d.label)) continue;
    if (laptopBaseline && boxIou(d.box, laptopBaseline) >= 0.18) continue;
    if (
      laptopBaseline &&
      Math.abs(
        d.box.originX +
          d.box.width / 2 -
          (laptopBaseline.originX + laptopBaseline.width / 2),
      ) < 0.08 &&
      Math.abs(
        d.box.originY +
          d.box.height / 2 -
          (laptopBaseline.originY + laptopBaseline.height / 2),
      ) < 0.08
    ) {
      continue;
    }
    phones.push(d.box);
  }
  return phones;
}

export function largestLaptopBox(
  detections: Array<{ label: string; score: number; box: NormBox }>,
): NormBox | null {
  let best: { box: NormBox; area: number } | null = null;
  for (const d of detections) {
    if (d.score < 0.35 || !isLaptopLikeLabel(d.label)) continue;
    const area = d.box.width * d.box.height;
    if (!best || area > best.area) best = { box: d.box, area };
  }
  return best?.box ?? null;
}

export function personBoxesFromDetections(
  detections: Array<{ label: string; score: number; box: NormBox }>,
): NormBox[] {
  const out: NormBox[] = [];
  for (const d of detections) {
    if (d.score < 0.38 || !isPersonLabel(d.label)) continue;
    if (d.box.width * d.box.height < 0.012) continue;
    out.push(d.box);
  }
  return out;
}

export function poseToBox(landmarks: NormPoint[]): NormBox | null {
  const pts = landmarks.filter((p) => (p.visibility ?? 1) >= 0.3);
  if (pts.length < 4) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 0.04 || height < 0.06) return null;
  return { originX: minX, originY: minY, width, height };
}

export function mergePersonBoxes(boxes: NormBox[]): NormBox[] {
  const sorted = [...boxes].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );
  const out: NormBox[] = [];
  for (const box of sorted) {
    if (out.some((kept) => boxIou(kept, box) >= 0.35)) continue;
    out.push(box);
  }
  return out;
}

export function primaryZoneFromBaseline(
  baseline: PoseBaseline | null,
): NormBox {
  if (!baseline) {
    return { originX: 0.12, originY: 0.18, width: 0.76, height: 0.72 };
  }
  const width = Math.max(0.42, Math.min(0.72, baseline.shoulderSpan * 3.2 + 0.3));
  const height = 0.64;
  return {
    originX: Math.max(0, Math.min(1 - width, baseline.torsoX - width / 2)),
    originY: Math.max(0, Math.min(1 - height, baseline.torsoY - 0.34)),
    width,
    height,
  };
}

/** Tiny / doorway / far-edge detections — do not warn. */
export function isFarBackground(box: NormBox): boolean {
  const area = box.width * box.height;
  const cx = box.originX + box.width / 2;
  const cy = box.originY + box.height / 2;
  if (area < 0.016) return true;
  if (cy < 0.14 && area < 0.05) return true;
  if ((cx < 0.07 || cx > 0.93) && area < 0.04) return true;
  return false;
}

function boxCenterInZone(box: NormBox, zone: NormBox): boolean {
  const cx = box.originX + box.width / 2;
  const cy = box.originY + box.height / 2;
  return (
    cx >= zone.originX &&
    cx <= zone.originX + zone.width &&
    cy >= zone.originY &&
    cy <= zone.originY + zone.height
  );
}

export function extraPersonsInPrimaryZone(
  boxes: NormBox[],
  zone: NormBox,
): { candidate: NormBox | null; extras: NormBox[] } {
  const close = boxes.filter((b) => !isFarBackground(b));
  if (close.length === 0) return { candidate: null, extras: [] };
  const inZone = close.filter(
    (b) => boxCenterInZone(b, zone) || boxIou(b, zone) >= 0.12,
  );
  const pool = inZone.length > 0 ? inZone : close;
  const candidate = pool.reduce((best, b) =>
    b.width * b.height > best.width * best.height ? b : best,
  );
  const extras = close.filter((b) => {
    if (boxIou(b, candidate) >= 0.4) return false;
    if (b.width * b.height < MIN_CLOSE_PERSON_AREA) return false;
    return boxCenterInZone(b, zone) || boxIou(b, zone) >= 0.12;
  });
  return { candidate, extras };
}
