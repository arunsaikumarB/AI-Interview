/**
 * R7 — device presence continuity.
 *
 * Run G (real phone, ENHANCED + STANDARD) proved the device signal was
 * unreachable for a reason that is not classification:
 *   16 raw cell-phone detections, 10 accepted by unexpectedPhones(),
 *   longest continuous run 1600ms — and live DEVICE_VISIBLE fired 0 times.
 *
 * Cause: secondary-integrity-client.ts reset `deviceSince = null` on any single
 * frame without a detection, so the 1500ms DEVICE_MS hold restarted from zero
 * every time the detector blinked. Real phone video produces intermittent
 * detections, so the hold effectively never completed.
 *
 * Fix under test: a BOUNDED absence window. Presence survives a short gap and
 * then genuinely lapses — it is not sticky. DEVICE_MS is unchanged at 1500ms,
 * thresholds are unchanged, labels are unchanged.
 *
 *   npx tsx --test tests/unit/device-presence-continuity.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_ABSENCE_GRACE_MS,
  DEVICE_GONE_MS,
  DEVICE_MS,
  createPresenceDebouncer,
} from "../../src/lib/secondary-integrity-cv";

/** Object detection runs every 2nd 400ms sample. */
const TICK = 800;

/**
 * Mirrors the client's DEVICE_VISIBLE / DEVICE_REMOVED hold logic, driven by
 * debounced presence. Lets a detection pattern be replayed deterministically.
 */
function simulate(pattern: boolean[], graceMs = DEVICE_ABSENCE_GRACE_MS) {
  const presence = createPresenceDebouncer({ graceMs });
  let deviceSince: number | null = null;
  let goneSince: number | null = null;
  let wasVisible = false;
  const visible: number[] = [];
  const removed: number[] = [];

  pattern.forEach((raw, i) => {
    const now = i * TICK;
    const present = presence.update(raw, now);
    if (present) {
      goneSince = null;
      if (deviceSince == null) deviceSince = now;
      if (now - deviceSince >= DEVICE_MS && !wasVisible) {
        wasVisible = true;
        visible.push(now);
      }
    } else {
      deviceSince = null;
      if (wasVisible) {
        if (goneSince == null) goneSince = now;
        if (now - goneSince >= DEVICE_GONE_MS) {
          wasVisible = false;
          goneSince = null;
          removed.push(now);
        }
      }
    }
  });
  return { visible, removed };
}

const on = (n: number) => Array<boolean>(n).fill(true);
const off = (n: number) => Array<boolean>(n).fill(false);

describe("R7 presence debouncer — bounded, not sticky", () => {
  it("the absence window is explicitly configured and shorter than DEVICE_MS", () => {
    assert.equal(DEVICE_MS, 1500, "DEVICE_MS must not be lowered by this fix");
    assert.ok(DEVICE_ABSENCE_GRACE_MS > 0);
    assert.ok(
      DEVICE_ABSENCE_GRACE_MS < DEVICE_MS,
      "grace must be shorter than the hold it protects",
    );
  });

  it("presence is true while detections arrive", () => {
    const p = createPresenceDebouncer({});
    assert.equal(p.update(true, 0), true);
    assert.equal(p.update(true, TICK), true);
  });

  it("presence survives a gap shorter than the window", () => {
    const p = createPresenceDebouncer({});
    p.update(true, 0);
    assert.equal(p.update(false, TICK), true, "one missed tick must not drop presence");
  });

  it("BOUNDED: presence lapses once the window is exceeded", () => {
    const p = createPresenceDebouncer({});
    p.update(true, 0);
    assert.equal(p.update(false, DEVICE_ABSENCE_GRACE_MS - 1), true);
    assert.equal(
      p.update(false, DEVICE_ABSENCE_GRACE_MS),
      false,
      "presence must expire — this is not sticky detection",
    );
  });

  it("BOUNDED: an indefinitely absent device never stays present", () => {
    const p = createPresenceDebouncer({});
    p.update(true, 0);
    let last = true;
    for (let i = 1; i <= 100; i++) last = p.update(false, i * TICK);
    assert.equal(last, false);
  });

  it("never reports presence before the first detection", () => {
    const p = createPresenceDebouncer({});
    for (let i = 0; i < 5; i++) {
      assert.equal(p.update(false, i * TICK), false);
    }
  });

  it("reset() clears presence immediately", () => {
    const p = createPresenceDebouncer({});
    p.update(true, 0);
    p.reset();
    assert.equal(p.update(false, TICK), false);
  });
});

describe("R7 A–E — DEVICE_VISIBLE / DEVICE_REMOVED behaviour", () => {
  it("A. continuous detections fire DEVICE_VISIBLE", () => {
    const { visible } = simulate(on(6));
    assert.equal(visible.length, 1);
    // Evaluated on tick boundaries, so the first tick at or after DEVICE_MS.
    assert.ok(visible[0] >= DEVICE_MS, "must not fire before the 1500ms hold");
    assert.ok(visible[0] < DEVICE_MS + TICK, "must fire on the first eligible tick");
  });

  it("B. one missed frame inside the window still fires DEVICE_VISIBLE", () => {
    // present, miss, present, present -> hold is never restarted
    const { visible } = simulate([true, false, true, true]);
    assert.equal(visible.length, 1, "a single detector blink must not defeat the hold");
  });

  it("C. several intermittent misses keep presence continuous", () => {
    const { visible, removed } = simulate([
      true, false, true, false, true, false, true, false, true,
    ]);
    assert.equal(visible.length, 1);
    assert.equal(removed.length, 0, "alternating misses are not an absence");
  });

  it("D. genuine absence beyond the window fires DEVICE_REMOVED", () => {
    const { visible, removed } = simulate([...on(4), ...off(8)]);
    assert.equal(visible.length, 1);
    assert.equal(removed.length, 1, "the device leaving must still be reported");
    assert.ok(
      removed[0] > visible[0],
      "DEVICE_REMOVED must follow DEVICE_VISIBLE",
    );
  });

  it("E. a device returning after genuine absence starts a new episode", () => {
    const { visible, removed } = simulate([...on(4), ...off(8), ...on(6)]);
    assert.equal(removed.length, 1);
    assert.equal(visible.length, 2, "a second appearance must be reportable");
    assert.ok(visible[1] > removed[0]);
  });

  it("presence lapsing is what allows DEVICE_REMOVED — grace only delays it", () => {
    const { removed } = simulate([...on(3), ...off(10)]);
    assert.equal(removed.length, 1);
  });
});

describe("R7 — Run G regression fixture", () => {
  /**
   * Accepted-detection pattern measured by replaying efficientdet_lite2 over
   * Run G's own recording at the app's 800ms object cadence:
   *   "..___________________#___.#_#_#.______#_#__#.##_________.#_"
   * '#' = passed unexpectedPhones(), '.' = phone detected but score-filtered,
   * '_' = no phone. 59 frames, 16 raw, 10 accepted, longest run 1600ms.
   */
  const RUN_G = "..___________________#___.#_#_#.______#_#__#.##_________.#_";
  const accepted = RUN_G.split("").map((c) => c === "#");

  it("the fixture matches the measured Run G numbers", () => {
    assert.equal(accepted.length, 59, "59 sampled frames");
    assert.equal(accepted.filter(Boolean).length, 10, "10 accepted detections");
    assert.equal(
      RUN_G.split("").filter((c) => c === "#" || c === ".").length,
      16,
      "16 raw cell-phone detections",
    );
  });

  it("BEFORE R7: the old reset-on-miss logic never reached the hold", () => {
    // Old behaviour == zero grace: any miss resets deviceSince.
    const { visible } = simulate(accepted, 0);
    assert.equal(
      visible.length,
      0,
      "reproduces the Run G failure: DEVICE_VISIBLE never fired",
    );
  });

  it("AFTER R7: the same Run G pattern fires DEVICE_VISIBLE", () => {
    const { visible } = simulate(accepted);
    assert.ok(
      visible.length >= 1,
      "Run G's real detection pattern must now produce DEVICE_VISIBLE",
    );
  });

  it("and it does so without lowering DEVICE_MS", () => {
    assert.equal(DEVICE_MS, 1500);
    const { visible } = simulate(accepted);
    assert.ok(visible.length >= 1);
  });
});

describe("R7 F — interaction gating is unchanged", () => {
  /**
   * DEVICE_INTERACTION still requires a live phone box plus wristNearBox or
   * headTowardBox. Presence debouncing must not manufacture an interaction
   * during a gap, because there is no fresh box to test the wrist against.
   */
  function simulateInteraction(
    frames: Array<{ raw: boolean; wristOrHead: boolean }>,
  ) {
    const presence = createPresenceDebouncer({});
    let interactionSince: number | null = null;
    const fired: number[] = [];
    frames.forEach((f, i) => {
      const now = i * TICK;
      presence.update(f.raw, now);
      // Interaction is evaluated only on a real detection.
      const interacting = f.raw && f.wristOrHead;
      if (interacting) {
        if (interactionSince == null) interactionSince = now;
        if (now - interactionSince >= 1500) {
          interactionSince = now + 60_000;
          fired.push(now);
        }
      } else {
        interactionSince = null;
      }
    });
    return fired;
  }

  it("no interaction without the wrist/head condition, even with presence", () => {
    const fired = simulateInteraction(
      Array.from({ length: 8 }, () => ({ raw: true, wristOrHead: false })),
    );
    assert.equal(fired.length, 0, "presence alone must never imply interaction");
  });

  it("interaction fires when the wrist/head condition holds", () => {
    const fired = simulateInteraction(
      Array.from({ length: 8 }, () => ({ raw: true, wristOrHead: true })),
    );
    assert.equal(fired.length, 1);
  });

  it("a debounced gap does not count toward interaction", () => {
    // raw=false during the gap -> interaction timer resets even though
    // presence is still true.
    const fired = simulateInteraction([
      { raw: true, wristOrHead: true },
      { raw: false, wristOrHead: true },
      { raw: true, wristOrHead: true },
    ]);
    assert.equal(fired.length, 0, "gap frames must not accumulate interaction time");
  });
});
