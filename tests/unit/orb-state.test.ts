import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveOrbState } from "../../src/components/interview/orb-state";

describe("deriveOrbState", () => {
  const base = {
    concluded: false,
    status: "IN_PROGRESS",
    thinking: false,
    pendingProcessing: false,
    recording: false,
    hasActiveQuestion: true,
    hasError: false,
    questionJustArrived: false,
  };

  it("uses AI_SPEAKING while a new question has just arrived", () => {
    assert.equal(deriveOrbState({ ...base, questionJustArrived: true }), "AI_SPEAKING");
  });

  it("listens after the question is delivered", () => {
    assert.equal(deriveOrbState(base), "CANDIDATE_LISTENING");
  });

  it("marks candidate speaking while recording", () => {
    assert.equal(
      deriveOrbState({ ...base, recording: true, questionJustArrived: true }),
      "CANDIDATE_SPEAKING",
    );
  });

  it("thinks while generating the next question", () => {
    assert.equal(
      deriveOrbState({ ...base, thinking: true, hasActiveQuestion: false }),
      "THINKING",
    );
  });

  it("processes a saved answer while a question is still on screen", () => {
    assert.equal(deriveOrbState({ ...base, thinking: true }), "PROCESSING");
    assert.equal(deriveOrbState({ ...base, pendingProcessing: true }), "PROCESSING");
  });

  it("completes when the interview has concluded", () => {
    assert.equal(deriveOrbState({ ...base, concluded: true }), "COMPLETED");
  });
});
