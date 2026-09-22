import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attentionDeviated,
  boxIou,
  captureBaseline,
  EMPTY_SUSTAINED,
  EXTRA_PERSON_FRAME_GRACE_MS,
  EXTRA_PERSON_GONE_MS,
  EXTRA_PERSON_MS,
  extraPersonsInPrimaryZone,
  largestDeskSurfaceBox,
  stepSustainedCondition,
  isFarBackground,
  isOutOfPosition,
  isPhoneLabel,
  unexpectedPhones,
} from "../../src/lib/secondary-integrity-cv";

describe("secondary integrity CV helpers", () => {
  it("computes IoU for overlapping boxes", () => {
    const a = { originX: 0, originY: 0, width: 1, height: 1 };
    const b = { originX: 0, originY: 0, width: 1, height: 1 };
    assert.equal(boxIou(a, b), 1);
    const c = { originX: 2, originY: 2, width: 0.1, height: 0.1 };
    assert.equal(boxIou(a, c), 0);
  });

  it("does not flag a phone overlapping the expected laptop", () => {
    const laptop = { originX: 0.2, originY: 0.5, width: 0.4, height: 0.3 };
    const phones = unexpectedPhones(
      [
        {
          label: "cell phone",
          score: 0.7,
          box: { originX: 0.22, originY: 0.52, width: 0.35, height: 0.25 },
        },
      ],
      laptop,
    );
    assert.equal(phones.length, 0);
  });

  it("flags a phone beside the laptop", () => {
    const laptop = { originX: 0.2, originY: 0.5, width: 0.4, height: 0.3 };
    const phones = unexpectedPhones(
      [
        {
          label: "cell phone",
          score: 0.7,
          box: { originX: 0.72, originY: 0.55, width: 0.12, height: 0.2 },
        },
      ],
      laptop,
    );
    assert.equal(phones.length, 1);
    assert.equal(isPhoneLabel("cell phone"), true);
  });

  it("detects standing vs seated baseline", () => {
    const baseline = captureBaseline(
      Array.from({ length: 6 }, () => ({
        hipY: 0.75,
        torsoY: 0.55,
        torsoX: 0.5,
        shoulderSpan: 0.25,
        noseX: 0.5,
      })),
    );
    assert.ok(baseline);
    assert.equal(
      isOutOfPosition(
        {
          hipY: 0.5,
          torsoY: 0.35,
          torsoX: 0.5,
          shoulderSpan: 0.25,
          noseX: 0.5,
        },
        baseline,
      ),
      true,
    );
    assert.equal(
      isOutOfPosition(
        {
          hipY: 0.74,
          torsoY: 0.54,
          torsoX: 0.51,
          shoulderSpan: 0.26,
          noseX: 0.5,
        },
        baseline,
      ),
      false,
    );
  });

  it("requires both baseline and torso offset for attention", () => {
    assert.equal(attentionDeviated(0.51, 0.5, 0.5), false);
    assert.equal(attentionDeviated(0.72, 0.5, 0.5), true);
  });

  it("ignores a tiny far-background person and flags a second person in the interview zone", () => {
    const zone = { originX: 0.2, originY: 0.2, width: 0.6, height: 0.65 };
    const candidate = { originX: 0.35, originY: 0.3, width: 0.28, height: 0.45 };
    const doorway = { originX: 0.02, originY: 0.02, width: 0.08, height: 0.12 };
    const helper = { originX: 0.55, originY: 0.32, width: 0.22, height: 0.4 };
    assert.equal(isFarBackground(doorway), true);
    assert.equal(isFarBackground(helper), false);
    const { extras } = extraPersonsInPrimaryZone(
      [candidate, doorway, helper],
      zone,
    );
    assert.equal(extras.length, 1);
    const alone = extraPersonsInPrimaryZone([candidate, doorway], zone);
    assert.equal(alone.extras.length, 0);
  });

  it("does not treat the candidate's arms or the laptop as another person", () => {
    const zone = { originX: 0.12, originY: 0.1, width: 0.76, height: 0.8 };
    const candidate = { originX: 0.3, originY: 0.22, width: 0.34, height: 0.55 };
    const arm = { originX: 0.36, originY: 0.48, width: 0.12, height: 0.16 };
    const laptop = { originX: 0.42, originY: 0.55, width: 0.28, height: 0.22 };
    const laptopAsPerson = { originX: 0.44, originY: 0.56, width: 0.2, height: 0.16 };
    const alone = extraPersonsInPrimaryZone(
      [candidate, arm, laptopAsPerson],
      zone,
      [laptop],
    );
    assert.equal(alone.extras.length, 0);
  });

  it("still flags a separate person who does not overlap the candidate or laptop", () => {
    const zone = { originX: 0.1, originY: 0.1, width: 0.8, height: 0.8 };
    const candidate = { originX: 0.15, originY: 0.25, width: 0.22, height: 0.4 };
    const other = { originX: 0.62, originY: 0.22, width: 0.2, height: 0.42 };
    const laptop = { originX: 0.2, originY: 0.62, width: 0.25, height: 0.18 };
    const { extras } = extraPersonsInPrimaryZone(
      [candidate, other],
      zone,
      [laptop],
    );
    assert.equal(extras.length, 1);
  });

  it("counts a detected keyboard as the desk surface", () => {
    const box = largestDeskSurfaceBox([
      { label: "keyboard", score: 0.62, box: { originX: 0.4, originY: 0.7, width: 0.3, height: 0.12 } },
      { label: "person", score: 0.9, box: { originX: 0.2, originY: 0.2, width: 0.3, height: 0.5 } },
    ]);
    assert.ok(box);
    assert.equal(
      largestDeskSurfaceBox([
        { label: "keyboard", score: 0.2, box: { originX: 0.4, originY: 0.7, width: 0.3, height: 0.12 } },
      ]),
      null,
    );
  });

  it("ignores one noisy extra-person frame and confirms a sustained one", () => {
    const opts = {
      holdMs: EXTRA_PERSON_MS,
      clearMs: EXTRA_PERSON_GONE_MS,
      graceMs: EXTRA_PERSON_FRAME_GRACE_MS,
    };
    const noisy = stepSustainedCondition(EMPTY_SUSTAINED, true, 0, opts);
    assert.equal(noisy.confirmed, false);
    const dropped = stepSustainedCondition(noisy, false, 400, opts);
    assert.equal(dropped.confirmed, false);
    const reset = stepSustainedCondition(dropped, false, 400 + EXTRA_PERSON_FRAME_GRACE_MS, opts);
    assert.equal(reset.activeSince, null);

    let state = EMPTY_SUSTAINED;
    state = stepSustainedCondition(state, true, 0, opts);
    state = stepSustainedCondition(state, false, 500, opts);
    state = stepSustainedCondition(state, true, 800, opts);
    assert.equal(state.confirmed, false);
    state = stepSustainedCondition(state, true, EXTRA_PERSON_MS, opts);
    assert.equal(state.confirmed, true);

    const still = stepSustainedCondition(state, false, EXTRA_PERSON_MS + 200, opts);
    assert.equal(still.confirmed, true);
    const cleared = stepSustainedCondition(
      still,
      false,
      EXTRA_PERSON_MS + 200 + EXTRA_PERSON_GONE_MS,
      opts,
    );
    assert.equal(cleared.confirmed, false);

    const again = stepSustainedCondition(
      stepSustainedCondition(cleared, true, 10_000, opts),
      true,
      10_000 + EXTRA_PERSON_MS,
      opts,
    );
    assert.equal(again.confirmed, true);
  });
});
