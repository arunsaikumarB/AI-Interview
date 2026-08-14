import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attentionDeviated,
  boxIou,
  captureBaseline,
  extraPersonsInPrimaryZone,
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
});
