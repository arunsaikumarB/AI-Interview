import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FinalResultSchema } from "../../src/lib/ai/interview";
import { StoredFinalResultSchema } from "../../src/lib/ai/stored-final-result";

const dimensions = {
  technicalKnowledge: 81,
  problemSolving: 82,
  communication: 84,
  roleKnowledge: 79,
  behavioral: 82,
  confidenceClarity: 83,
};

describe("StoredFinalResultSchema — read side of INTERVIEW_OVERALL scores", () => {
  it("accepts a stored row with only overall + dimensions and defaults the lists", () => {
    const parsed = StoredFinalResultSchema.safeParse({ overall: 82, dimensions, demoBatch: "x" });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.overall, 82);
    assert.deepEqual(parsed.data?.strengths, []);
    assert.deepEqual(parsed.data?.weaknesses, []);
    assert.deepEqual(parsed.data?.resumeValidation, []);
  });

  it("does not loosen the strict schema used to validate LLM output", () => {
    assert.equal(FinalResultSchema.safeParse({ overall: 82, dimensions }).success, false);
  });

  it("keeps full LLM results intact", () => {
    const full = {
      overall: 71,
      dimensions,
      strengths: ["Clear API reasoning"],
      weaknesses: ["Light on observability"],
      resumeValidation: [{ claim: "Led migration", verdict: "PARTIAL", evidence: "Q2 answer" }],
    };
    const parsed = StoredFinalResultSchema.safeParse(full);
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.data?.strengths, full.strengths);
    assert.equal(parsed.data?.resumeValidation[0]?.verdict, "PARTIAL");
  });

  it("rejects rows without dimensions so they are never shown as a completed report", () => {
    const parsed = StoredFinalResultSchema.safeParse({
      overall: 71,
      communication: 70,
      technical: 72,
    });
    assert.equal(parsed.success, false);
  });

  it("rejects out-of-range scores", () => {
    assert.equal(StoredFinalResultSchema.safeParse({ overall: 140, dimensions }).success, false);
    assert.equal(
      StoredFinalResultSchema.safeParse({
        overall: 80,
        dimensions: { ...dimensions, communication: -1 },
      }).success,
      false,
    );
  });
});
