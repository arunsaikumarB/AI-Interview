/**
 * R8 — device INTERACTION continuity.
 *
 * Run I (real phone, ENHANCED + STANDARD) fired SECONDARY_DEVICE_VISIBLE six
 * times but SECONDARY_DEVICE_INTERACTION zero times — and zero across every
 * session in the entire UAT.
 *
 * Cause is structural, not behavioural. sample() runs every SAMPLE_MS (400ms)
 * but object detection only runs every OBJECT_EVERY_N (2nd) tick, so `phones`
 * is empty on ~half of all frames *by construction*, before any detector
 * intermittency. The interaction condition requires a live phone box, and
 * `interactionSince = null` on any frame without one, so the 1500ms
 * INTERACTION_MS hold could never accumulate.
 *
 * R7 solved the same shape for DEVICE_VISIBLE by debouncing presence. R8 does
 * the equivalent for interaction by remembering the most recently observed
 * phone box for a BOUNDED window, so the wrist/head geometry still has
 * something to evaluate against on frames where detection did not run.
 *
 * The geometry requirement itself is NOT relaxed: it is re-evaluated every
 * frame against a real, recently-observed box. If the wrist moves away the
 * condition fails immediately. If the phone is genuinely gone the box expires
 * and no interaction is possible.
 *
 *   npx tsx --test tests/unit/device-interaction-continuity.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_BOX_MEMORY_MS,
  INTERACTION_MS,
  createBoxMemory,
  type NormBox,
} from "../../src/lib/secondary-integrity-cv";

const SAMPLE_MS = 400;
const OBJECT_EVERY_N = 2;

const PHONE_BOX: NormBox = { originX: 0.55, originY: 0.45, width: 0.1, height: 0.18 };

type Frame = {
  /** Did the object detector actually return a phone this sample? */
  rawPhone: boolean;
  /** Pose landmarks available this sample. */
  metrics: boolean;
  /** wristNearBox() || headTowardBox() evaluated against the box in play. */
  geometry: boolean;
};

/**
 * Replays the client's interaction hold.
 * `ttlMs = 0` reproduces pre-R8 behaviour (box only usable on the exact frame
 * the detector produced it).
 */
function simulateInteraction(frames: Frame[], ttlMs = DEVICE_BOX_MEMORY_MS) {
  const boxMemory = createBoxMemory({ ttlMs });
  let interactionSince: number | null = null;
  const fired: number[] = [];

  frames.forEach((f, i) => {
    const now = i * SAMPLE_MS;
    const box = boxMemory.update(f.rawPhone ? PHONE_BOX : null, now);
    // Geometry is evaluated every frame, against a real observed box.
    const interacting = Boolean(box && f.metrics && f.geometry);
    if (interacting) {
      if (interactionSince == null) interactionSince = now;
      if (now - interactionSince >= INTERACTION_MS) {
        interactionSince = now + 60_000;
        fired.push(now);
      }
    } else {
      interactionSince = null;
    }
  });
  return fired;
}

/**
 * The Run I reality: object detection only runs on every OBJECT_EVERY_N-th
 * sample, and the detector hits on only some of those. `detectorHitRate` of 1
 * means every object tick produced a phone.
 */
function runIPattern(count: number, detectorHitRate = 1, geometry = true): Frame[] {
  return Array.from({ length: count }, (_, i) => {
    const objectRan = i % OBJECT_EVERY_N === 0;
    const hit = objectRan && (detectorHitRate === 1 || i % Math.round(1 / detectorHitRate / OBJECT_EVERY_N) === 0);
    return { rawPhone: Boolean(hit), metrics: true, geometry };
  });
}

describe("R8 box memory — bounded, geometry never relaxed", () => {
  it("the memory window is explicit and bounded", () => {
    assert.ok(DEVICE_BOX_MEMORY_MS > 0);
    assert.ok(
      DEVICE_BOX_MEMORY_MS >= SAMPLE_MS * OBJECT_EVERY_N,
      "must at least bridge the ticks where object detection does not run",
    );
    assert.equal(INTERACTION_MS, 1500, "interaction threshold must not change");
  });

  it("returns the live box on a detection frame", () => {
    const m = createBoxMemory({});
    assert.deepEqual(m.update(PHONE_BOX, 0), PHONE_BOX);
  });

  it("retains the box across a gap shorter than the window", () => {
    const m = createBoxMemory({});
    m.update(PHONE_BOX, 0);
    assert.deepEqual(m.update(null, SAMPLE_MS), PHONE_BOX);
  });

  it("BOUNDED: the box expires once the window is exceeded", () => {
    const m = createBoxMemory({});
    m.update(PHONE_BOX, 0);
    assert.ok(m.update(null, DEVICE_BOX_MEMORY_MS - 1));
    assert.equal(
      m.update(null, DEVICE_BOX_MEMORY_MS),
      null,
      "memory must expire — it cannot keep a vanished phone alive",
    );
  });

  it("BOUNDED: an indefinitely absent phone never yields a box", () => {
    const m = createBoxMemory({});
    m.update(PHONE_BOX, 0);
    let last: NormBox | null = PHONE_BOX;
    for (let i = 1; i <= 100; i++) last = m.update(null, i * SAMPLE_MS);
    assert.equal(last, null);
  });

  it("never invents a box before the first detection", () => {
    const m = createBoxMemory({});
    for (let i = 0; i < 5; i++) assert.equal(m.update(null, i * SAMPLE_MS), null);
  });

  it("reset() clears memory immediately", () => {
    const m = createBoxMemory({});
    m.update(PHONE_BOX, 0);
    m.reset();
    assert.equal(m.update(null, SAMPLE_MS), null);
  });
});

describe("R8 — Run I pattern, before and after", () => {
  it("the fixture reflects the real cadence: detection on alternate samples only", () => {
    const frames = runIPattern(10);
    assert.equal(frames.filter((f) => f.rawPhone).length, 5, "half the frames, by construction");
    assert.equal(frames[0].rawPhone, true);
    assert.equal(frames[1].rawPhone, false, "object detection did not run this sample");
  });

  it("BEFORE R8: the Run I pattern never fires DEVICE_INTERACTION", () => {
    // ttl 0 == old behaviour: the box exists only on the detection frame.
    const fired = simulateInteraction(runIPattern(40), 0);
    assert.equal(
      fired.length,
      0,
      "reproduces the live Run I failure: 0 interactions despite tapping throughout",
    );
  });

  it("AFTER R8: the same Run I pattern fires DEVICE_INTERACTION", () => {
    const fired = simulateInteraction(runIPattern(40));
    assert.ok(fired.length >= 1, "sustained tapping must now be reported");
  });

  it("AFTER R8: still honours the full 1500ms threshold", () => {
    const fired = simulateInteraction(runIPattern(40));
    assert.ok(fired[0] >= INTERACTION_MS, "must not fire earlier than INTERACTION_MS");
  });

  it("also works when the detector additionally blinks on object ticks", () => {
    const frames = runIPattern(60, 0.5);
    const before = simulateInteraction(frames, 0);
    const after = simulateInteraction(frames);
    assert.equal(before.length, 0);
    assert.ok(after.length >= 1, "intermittent detector output must still accumulate");
  });
});

describe("R8 — cannot manufacture an interaction", () => {
  it("no phone ever detected -> no interaction, however strong the geometry", () => {
    const frames: Frame[] = Array.from({ length: 40 }, () => ({
      rawPhone: false,
      metrics: true,
      geometry: true,
    }));
    assert.equal(simulateInteraction(frames).length, 0);
  });

  it("REGRESSION: phone genuinely removed -> interaction stops, does not persist", () => {
    // 20 frames of tapping, then the phone is gone for the rest.
    const frames = [...runIPattern(20), ...Array.from({ length: 40 }, () => ({
      rawPhone: false, metrics: true, geometry: true,
    }))];
    const fired = simulateInteraction(frames);
    const lastFire = fired[fired.length - 1] ?? -1;
    const removalAt = 20 * SAMPLE_MS;
    assert.ok(
      lastFire < removalAt + DEVICE_BOX_MEMORY_MS,
      "no interaction may be reported once the box has expired",
    );
  });

  it("phone present but wrist/head condition false -> no interaction", () => {
    const frames = runIPattern(40, 1, /* geometry */ false);
    assert.equal(
      simulateInteraction(frames).length,
      0,
      "geometry is still mandatory — R8 must not weaken it",
    );
  });

  it("geometry lapsing mid-hold resets the timer immediately", () => {
    // Tapping, then hand withdrawn: geometry false while phone still visible.
    const frames: Frame[] = [];
    for (let i = 0; i < 3; i++) frames.push({ rawPhone: i % 2 === 0, metrics: true, geometry: true });
    for (let i = 0; i < 10; i++) frames.push({ rawPhone: i % 2 === 0, metrics: true, geometry: false });
    assert.equal(
      simulateInteraction(frames).length,
      0,
      "withdrawing the hand must stop interaction accumulating",
    );
  });

  it("missing pose metrics blocks interaction even with a remembered box", () => {
    const frames = runIPattern(40).map((f) => ({ ...f, metrics: false }));
    assert.equal(simulateInteraction(frames).length, 0);
  });
});

describe("R8 — unrelated behaviour untouched", () => {
  it("INTERACTION_MS is unchanged at 1500ms", () => {
    assert.equal(INTERACTION_MS, 1500);
  });

  it("box memory is independent of presence debouncing (separate concerns)", async () => {
    const cv = await import("../../src/lib/secondary-integrity-cv");
    assert.equal(typeof cv.createPresenceDebouncer, "function", "R7 helper still present");
    assert.equal(cv.DEVICE_MS, 1500, "R7 hold unchanged");
    assert.equal(cv.DEVICE_ABSENCE_GRACE_MS, 1200, "R7 window unchanged");
  });
});
