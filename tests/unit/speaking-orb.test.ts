import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseInterviewOrbVariant,
  readInterviewOrbFlag,
} from "../../src/lib/interview-orb-flag";
import {
  SPEAKING_ORB_MAX_PX,
  SPEAKING_ORB_PARTICLES_COMPACT,
  SPEAKING_ORB_PARTICLES_DESKTOP,
  mapLifecycleToSpeakingOrb,
  scaleSpeakingOrbSize,
  speakingOrbParticleCount,
  speakingOrbRestState,
} from "../../src/components/interview/speaking-orb-state";

const idle = {
  aiSpeaking: false,
  candidateRecording: false,
  voiceSubmitting: false,
  processing: false,
};

describe("parseInterviewOrbVariant", () => {
  it("defaults to the speaking orb", () => {
    assert.equal(parseInterviewOrbVariant(undefined), "speaking");
    assert.equal(parseInterviewOrbVariant(null), "speaking");
    assert.equal(parseInterviewOrbVariant(""), "speaking");
    assert.equal(parseInterviewOrbVariant("speaking"), "speaking");
    assert.equal(parseInterviewOrbVariant(" SPEAKING "), "speaking");
  });

  it("classic is the only value that restores the previous orb", () => {
    assert.equal(parseInterviewOrbVariant("classic"), "classic");
    assert.equal(parseInterviewOrbVariant(" Classic "), "classic");
    assert.equal(parseInterviewOrbVariant("nope"), "speaking");
  });
});

describe("readInterviewOrbFlag", () => {
  it("reads the public flag at runtime and ignores blanks", () => {
    const key = "NEXT_PUBLIC_INTERVIEW_ORB";
    const previous = process.env[key];
    process.env[key] = "classic";
    assert.equal(readInterviewOrbFlag(), "classic");
    process.env[key] = "   ";
    assert.equal(readInterviewOrbFlag(), undefined);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
});

describe("mapLifecycleToSpeakingOrb", () => {
  it("maps interviewer phases onto speaking-orb states", () => {
    assert.equal(mapLifecycleToSpeakingOrb({ ...idle, aiSpeaking: true }), "speaking");
    assert.equal(
      mapLifecycleToSpeakingOrb({ ...idle, candidateRecording: true }),
      "listening",
    );
    assert.equal(
      mapLifecycleToSpeakingOrb({ ...idle, voiceSubmitting: true }),
      "thinking",
    );
    assert.equal(mapLifecycleToSpeakingOrb({ ...idle, processing: true }), "thinking");
    assert.equal(mapLifecycleToSpeakingOrb(idle), "listening");
    assert.equal(
      mapLifecycleToSpeakingOrb({ ...idle, concluded: true, aiSpeaking: true }),
      "done",
    );
  });

  it("keeps the classic priority order, then done", () => {
    assert.equal(
      mapLifecycleToSpeakingOrb({
        aiSpeaking: true,
        candidateRecording: true,
        voiceSubmitting: true,
        processing: true,
      }),
      "speaking",
    );
    assert.equal(
      mapLifecycleToSpeakingOrb({
        aiSpeaking: false,
        candidateRecording: true,
        voiceSubmitting: true,
        processing: true,
      }),
      "thinking",
    );
  });

  it("rest state is where Piper returns when the question audio ends", () => {
    assert.equal(
      speakingOrbRestState({ ...idle, aiSpeaking: true }),
      "listening",
    );
    assert.equal(
      speakingOrbRestState({ ...idle, aiSpeaking: true, processing: true }),
      "thinking",
    );
    assert.equal(
      speakingOrbRestState({ ...idle, aiSpeaking: true, concluded: true }),
      "done",
    );
  });
});

describe("scaleSpeakingOrbSize", () => {
  it("grows the 160px desktop orb into the 240–280 band and scales mobile with it", () => {
    assert.equal(scaleSpeakingOrbSize(160), 264);
    assert.ok(scaleSpeakingOrbSize(160) >= 240);
    assert.ok(scaleSpeakingOrbSize(160) <= 280);
    assert.equal(scaleSpeakingOrbSize(148), 244);
    assert.ok(scaleSpeakingOrbSize(148) > 148 * 1.5);
    assert.equal(scaleSpeakingOrbSize(220), SPEAKING_ORB_MAX_PX);
  });
});

describe("speakingOrbParticleCount", () => {
  it("uses fewer particles on phones and coarse pointers", () => {
    assert.equal(
      speakingOrbParticleCount({ width: 390, coarsePointer: true }),
      SPEAKING_ORB_PARTICLES_COMPACT,
    );
    assert.equal(
      speakingOrbParticleCount({ width: 1440, coarsePointer: true }),
      SPEAKING_ORB_PARTICLES_COMPACT,
    );
    assert.equal(
      speakingOrbParticleCount({ width: 700, coarsePointer: false }),
      SPEAKING_ORB_PARTICLES_COMPACT,
    );
    assert.equal(
      speakingOrbParticleCount({ width: 1280, coarsePointer: false }),
      SPEAKING_ORB_PARTICLES_DESKTOP,
    );
    assert.ok(SPEAKING_ORB_PARTICLES_COMPACT >= 200);
    assert.ok(SPEAKING_ORB_PARTICLES_DESKTOP <= 20000);
    assert.ok(SPEAKING_ORB_PARTICLES_COMPACT < SPEAKING_ORB_PARTICLES_DESKTOP);
  });
});

describe("vendored speaking orb", () => {
  it("keeps the MIT notice and the HireOS playback/caption patches", () => {
    const license = readFileSync("public/vendor/speaking-orb/LICENSE", "utf8");
    const source = readFileSync("public/vendor/speaking-orb/speaking-orb.js", "utf8");
    assert.match(license, /MIT License/);
    assert.match(license, /Copyright \(c\) 2026 Ship Notes/);
    assert.match(source, /Copyright \(c\) 2026 Ship Notes/);
    assert.match(source, /captions=off/);
    assert.match(source, /if \(!external\)/);
    assert.match(source, /r\*12\*unit/);
    assert.doesNotMatch(source, /https?:\/\/(?!aqualang89)/);
  });
});
