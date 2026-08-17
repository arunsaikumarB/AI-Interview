/**
 * F-05 regression — Enhanced proctoring must not terminate a legitimate
 * interview because of ordinary candidate movement.
 *
 * Covers the three approved remediations:
 *   R1 baseline is captured only after placement confirmation AND settling
 *   R2 one continuous condition is ONE episode
 *   R5 STANDARD never auto-terminates from secondary-camera signals
 *
 * Original defect (Run C, session cmsvmbojl006alds17v489fcx):
 *   camera up 09:45:32.5 -> baseline frozen ~09:45:38.5 from SETUP posture
 *   placement confirmed 09:46:07.8 (29s later, no recapture)
 *   settled posture then read as out-of-position forever
 *   PERSON_MOVED x3 + ATTENTION_DEVIATION x1 = 4 -> TERMINATED in 44s,
 *   0 questions answered, integrityMode was STANDARD.
 *
 *   npx tsx --test tests/unit/secondary-integrity-f05.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_MIN_SAMPLES,
  SECONDARY_EPISODE_CLEAR_MS,
  captureBaseline,
  createEpisodeTracker,
  isOutOfPosition,
  isSettled,
  type PoseBaseline,
} from "../../src/lib/secondary-integrity-cv";
import {
  SECONDARY_INTEGRITY_POLICY,
  secondaryTerminationEnabled,
  shouldTerminateSecondary,
} from "../../src/lib/integrity";

/** Leaning in, arm out, propping the phone: torso low/close, shoulders wide. */
const SETUP_POSTURE: PoseBaseline = {
  hipY: 0.92,
  torsoY: 0.74,
  torsoX: 0.38,
  shoulderSpan: 0.46,
  noseX: 0.34,
};

/** Sitting back normally for the interview. */
const SETTLED_POSTURE: PoseBaseline = {
  hipY: 0.9,
  torsoY: 0.52,
  torsoX: 0.5,
  shoulderSpan: 0.26,
  noseX: 0.5,
};

function jitter(base: PoseBaseline, n: number, amp = 0.008): PoseBaseline[] {
  return Array.from({ length: n }, (_, i) => {
    const d = (i % 2 === 0 ? 1 : -1) * amp;
    return {
      hipY: base.hipY + d,
      torsoY: base.torsoY + d,
      torsoX: base.torsoX + d,
      shoulderSpan: base.shoulderSpan + d / 2,
      noseX: base.noseX + d,
    };
  });
}

describe("F-05 R1 — baseline is captured only once the candidate has settled", () => {
  it("a still, settled window is recognised as settled", () => {
    assert.equal(isSettled(jitter(SETTLED_POSTURE, 10)), true);
  });

  it("a window spanning setup -> settled is NOT settled", () => {
    const moving = [...jitter(SETUP_POSTURE, 5), ...jitter(SETTLED_POSTURE, 5)];
    assert.equal(isSettled(moving), false);
  });

  it("too few samples is never settled", () => {
    assert.equal(isSettled(jitter(SETTLED_POSTURE, BASELINE_MIN_SAMPLES - 1)), false);
    assert.equal(isSettled([]), false);
  });

  it("REGRESSION: settled posture is out-of-position against a SETUP baseline", () => {
    // This is the Run C defect, pinned so it cannot silently return.
    const badBaseline = captureBaseline(jitter(SETUP_POSTURE, 10));
    assert.ok(badBaseline);
    assert.equal(
      isOutOfPosition(SETTLED_POSTURE, badBaseline!),
      true,
      "a setup-time baseline makes normal seated posture look like movement",
    );
  });

  it("REGRESSION: settled posture is in-position against a SETTLED baseline", () => {
    const goodBaseline = captureBaseline(jitter(SETTLED_POSTURE, 10));
    assert.ok(goodBaseline);
    assert.equal(
      isOutOfPosition(SETTLED_POSTURE, goodBaseline!),
      false,
      "sitting normally must not read as out-of-position",
    );
  });

  it("small natural fidgeting against a settled baseline does not trip the threshold", () => {
    const goodBaseline = captureBaseline(jitter(SETTLED_POSTURE, 10))!;
    for (const drift of [0.01, 0.05, 0.1, 0.15]) {
      const fidget: PoseBaseline = {
        ...SETTLED_POSTURE,
        torsoX: SETTLED_POSTURE.torsoX + drift,
        torsoY: SETTLED_POSTURE.torsoY + drift,
      };
      assert.equal(
        isOutOfPosition(fidget, goodBaseline),
        false,
        `drift ${drift} should stay within tolerance`,
      );
    }
  });

  it("genuinely standing up is still detected against a settled baseline", () => {
    const goodBaseline = captureBaseline(jitter(SETTLED_POSTURE, 10))!;
    const standing: PoseBaseline = { ...SETTLED_POSTURE, hipY: SETTLED_POSTURE.hipY - 0.25 };
    assert.equal(isOutOfPosition(standing, goodBaseline), true);
  });
});

describe("F-05 R2 — one continuous condition is one episode", () => {
  const HOLD = 2_000;

  function tracker() {
    return createEpisodeTracker({ kind: "PERSON_MOVED", holdMs: HOLD });
  }

  it("fires exactly once for a single unbroken condition", () => {
    const t = tracker();
    let fires = 0;
    // 60s of continuous out-of-position, sampled every 400ms
    for (let ms = 0; ms <= 60_000; ms += 400) {
      if (t.update(true, ms).fire) fires++;
    }
    assert.equal(fires, 1, "one continuous condition must not re-fire");
  });

  it("does not fire before the hold window elapses", () => {
    const t = tracker();
    assert.equal(t.update(true, 0).fire, false);
    assert.equal(t.update(true, HOLD - 400).fire, false);
    assert.equal(t.update(true, HOLD).fire, true);
  });

  it("REGRESSION: a momentary in-position frame does not re-arm the episode", () => {
    // Exactly the Run C amplifier: `else { movedSince = null }` re-armed a
    // fresh 2s countdown, so the same condition billed 3 separate violations.
    const t = tracker();
    let fires = 0;
    let now = 0;
    const step = (active: boolean, dt: number) => {
      now += dt;
      if (t.update(active, now).fire) fires++;
    };
    step(true, 0);
    step(true, HOLD); // fire 1
    for (let i = 0; i < 10; i++) {
      step(false, 400); // one clear frame — far below the clear window
      step(true, 400);
      step(true, HOLD);
    }
    assert.equal(fires, 1, "flicker must not create new episodes");
  });

  it("keeps one stable episodeId for the whole episode", () => {
    const t = tracker();
    t.update(true, 0);
    const fired = t.update(true, HOLD);
    assert.equal(fired.fire, true);
    const id = fired.episodeId;
    assert.ok(id);
    for (let ms = HOLD + 400; ms < 30_000; ms += 400) {
      t.update(true, ms);
      assert.equal(t.current(), id, "episodeId must not change mid-episode");
    }
  });

  it("a genuinely new episode after a stable clear gets a different id", () => {
    const t = tracker();
    t.update(true, 0);
    const first = t.update(true, HOLD);
    assert.equal(first.fire, true);

    // Stable clear for longer than the clear window.
    let now = HOLD;
    for (let i = 0; i < 20; i++) {
      now += 400;
      t.update(false, now);
    }
    assert.equal(t.current(), null, "episode should have ended after a stable clear");

    now += 400;
    t.update(true, now);
    const second = t.update(true, now + HOLD);
    assert.equal(second.fire, true, "a genuine second episode must be reportable");
    assert.notEqual(second.episodeId, first.episodeId);
  });

  it("requires the clear window before ending an episode", () => {
    const t = tracker();
    t.update(true, 0);
    t.update(true, HOLD);
    const id = t.current();
    assert.ok(id);

    // The clear window is measured from the FIRST clear frame, not from the
    // moment the episode fired — "continuously clear for clearMs".
    const firstClearAt = HOLD + 400;
    t.update(false, firstClearAt);
    assert.equal(t.current(), id, "episode open on the first clear frame");

    t.update(false, firstClearAt + SECONDARY_EPISODE_CLEAR_MS - 400);
    assert.equal(t.current(), id, "episode still open just before the clear window");

    t.update(false, firstClearAt + SECONDARY_EPISODE_CLEAR_MS);
    assert.equal(t.current(), null, "episode closed once stably clear");
  });

  it("reset() abandons the current episode", () => {
    const t = tracker();
    t.update(true, 0);
    t.update(true, HOLD);
    assert.ok(t.current());
    t.reset();
    assert.equal(t.current(), null);
  });

  it("Run C sequence now costs one slot instead of three", () => {
    // Replay: out-of-position from 09:46:30 onward with brief flickers.
    const t = tracker();
    let fires = 0;
    let now = 0;
    for (let i = 0; i < 120; i++) {
      now += 400;
      const active = i % 17 !== 0; // occasional single clear frame
      if (t.update(active, now).fire) fires++;
    }
    assert.equal(fires, 1);
    assert.ok(
      fires < SECONDARY_INTEGRITY_POLICY.terminateAt,
      "must not be able to reach terminateAt from one continuous condition",
    );
  });
});

describe("F-05 R5 — STANDARD is warn/review-only", () => {
  const { terminateAt } = SECONDARY_INTEGRITY_POLICY;

  it("STANDARD never terminates, even past the threshold", () => {
    for (const n of [1, terminateAt - 1, terminateAt, terminateAt + 5, 99]) {
      assert.equal(
        shouldTerminateSecondary({ mode: "STANDARD", nextCount: n }),
        false,
        `STANDARD must not terminate at count ${n}`,
      );
    }
  });

  it("REGRESSION: the exact Run C count of 4 in STANDARD does not terminate", () => {
    assert.equal(shouldTerminateSecondary({ mode: "STANDARD", nextCount: 4 }), false);
  });

  it("STRICT still terminates at the configured threshold", () => {
    assert.equal(shouldTerminateSecondary({ mode: "STRICT", nextCount: terminateAt }), true);
    assert.equal(shouldTerminateSecondary({ mode: "STRICT", nextCount: terminateAt + 1 }), true);
  });

  it("STRICT does not terminate below the threshold", () => {
    for (let n = 1; n < terminateAt; n++) {
      assert.equal(shouldTerminateSecondary({ mode: "STRICT", nextCount: n }), false);
    }
  });

  it("termination capability is explicitly configurable per mode", () => {
    assert.equal(secondaryTerminationEnabled("STRICT"), true);
    assert.equal(secondaryTerminationEnabled("STANDARD"), false);
  });

  it("policy constants are unchanged (R3 severity weighting NOT implemented)", () => {
    assert.equal(SECONDARY_INTEGRITY_POLICY.warningLimit, 3);
    assert.equal(SECONDARY_INTEGRITY_POLICY.terminateAt, 4);
  });
});
