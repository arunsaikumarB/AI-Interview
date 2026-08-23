import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveInterviewThinkingOrbState,
  deriveInterviewUiPhase,
  thinkingOrbStatusLabel,
} from "../../src/components/interview/orb-state";

describe("deriveInterviewThinkingOrbState — required mapping", () => {
  const idle = {
    aiSpeaking: false,
    candidateRecording: false,
    voiceSubmitting: false,
    processing: false,
  };

  it("AI asking / speaking → breathing", () => {
    assert.equal(
      deriveInterviewThinkingOrbState({ ...idle, aiSpeaking: true }),
      "breathing",
    );
  });

  it("candidate recording → listening", () => {
    assert.equal(
      deriveInterviewThinkingOrbState({ ...idle, candidateRecording: true }),
      "listening",
    );
  });

  it("candidate submits voice → composing", () => {
    assert.equal(
      deriveInterviewThinkingOrbState({ ...idle, voiceSubmitting: true }),
      "composing",
    );
  });

  it("AI understanding → connecting", () => {
    assert.equal(
      deriveInterviewThinkingOrbState({ ...idle, processing: true }),
      "connecting",
    );
  });

  it("never shows conflicting priorities incorrectly", () => {
    assert.equal(
      deriveInterviewThinkingOrbState({
        aiSpeaking: true,
        candidateRecording: true,
        voiceSubmitting: true,
        processing: true,
      }),
      "breathing",
    );
    assert.equal(
      deriveInterviewThinkingOrbState({
        aiSpeaking: false,
        candidateRecording: true,
        voiceSubmitting: true,
        processing: true,
      }),
      "composing",
    );
  });

  it("full cycle: breathing → listening → composing → connecting → breathing", () => {
    assert.equal(
      deriveInterviewThinkingOrbState({ ...idle, aiSpeaking: true }),
      "breathing",
    );
    assert.equal(
      deriveInterviewThinkingOrbState({ ...idle, candidateRecording: true }),
      "listening",
    );
    assert.equal(
      deriveInterviewThinkingOrbState({ ...idle, voiceSubmitting: true }),
      "composing",
    );
    assert.equal(
      deriveInterviewThinkingOrbState({ ...idle, processing: true }),
      "connecting",
    );
    assert.equal(deriveInterviewThinkingOrbState(idle), "breathing");
  });
});

describe("deriveInterviewUiPhase", () => {
  it("maps to exclusive phases", () => {
    assert.equal(
      deriveInterviewUiPhase({
        aiSpeaking: true,
        candidateRecording: false,
        voiceSubmitting: false,
        processing: false,
      }),
      "AI_SPEAKING",
    );
    assert.equal(
      deriveInterviewUiPhase({
        aiSpeaking: false,
        candidateRecording: true,
        voiceSubmitting: false,
        processing: false,
      }),
      "CANDIDATE_RECORDING",
    );
    assert.equal(
      deriveInterviewUiPhase({
        aiSpeaking: false,
        candidateRecording: false,
        voiceSubmitting: true,
        processing: false,
      }),
      "ANSWER_SUBMITTING",
    );
    assert.equal(
      deriveInterviewUiPhase({
        aiSpeaking: false,
        candidateRecording: false,
        voiceSubmitting: false,
        processing: true,
      }),
      "AI_ANALYZING",
    );
  });
});

describe("thinkingOrbStatusLabel", () => {
  it("uses premium candidate-facing copy", () => {
    assert.match(thinkingOrbStatusLabel("breathing"), /asking|question/i);
    assert.match(thinkingOrbStatusLabel("listening"), /Listening/i);
    assert.match(thinkingOrbStatusLabel("composing"), /Processing/i);
    assert.match(thinkingOrbStatusLabel("connecting"), /Understanding/i);
  });
});
