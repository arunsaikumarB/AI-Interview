/**
 * R-3 — AI evaluation failure and retry handling.
 *
 * The audit reproduced a dropped final evaluation: `scoreInBackground` catches
 * every error and only console.warn/console.error's it, so a failed evaluation
 * is indistinguishable from one that is still running. The recruiter UI showed
 * "Final evaluation missing — regenerate" the instant the interview completed,
 * which is a false alarm while generation is legitimately in flight and gives
 * no signal at all once it has genuinely failed.
 *
 * These tests pin the four hard requirements:
 *   1. a failure is durable and typed, never silent
 *   2. nothing is fabricated — no score, recommendation or reasoning
 *   3. retries are bounded
 *   4. pending, completed and failed are distinguishable
 *
 *   npx tsx --test tests/unit/evaluation-status.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AI_EVALUATION_TIMELINE_KIND,
  MAX_EVALUATION_ATTEMPTS,
  deriveEvaluationState,
  evaluationFailurePayload,
  evaluationSuccessPayload,
  isRetryableEvaluationError,
  redactEvaluationError,
} from "../../src/lib/ai/evaluation-status";

const SESSION = "sess_1";

describe("R-3 bounded retry", () => {
  it("allows more than one attempt but is finite", () => {
    assert.ok(MAX_EVALUATION_ATTEMPTS >= 2, "one shot is what caused the silent drop");
    assert.ok(MAX_EVALUATION_ATTEMPTS <= 4, "must not become an unbounded retry loop");
  });

  it("retries transient AI failures until the cap", () => {
    const timeout = new Error("The operation timed out");
    for (let attempt = 1; attempt < MAX_EVALUATION_ATTEMPTS; attempt++) {
      assert.equal(isRetryableEvaluationError(timeout, attempt), true, `attempt ${attempt}`);
    }
  });

  it("STOPS at the cap — no infinite loop", () => {
    const timeout = new Error("The operation timed out");
    assert.equal(isRetryableEvaluationError(timeout, MAX_EVALUATION_ATTEMPTS), false);
    assert.equal(isRetryableEvaluationError(timeout, MAX_EVALUATION_ATTEMPTS + 5), false);
  });

  it("does not retry a validation error — retrying cannot fix bad input", () => {
    const bad = Object.assign(new Error("Model returned malformed JSON"), {
      name: "AIError",
      kind: "VALIDATION",
    });
    assert.equal(isRetryableEvaluationError(bad, 1), false);
  });

  it("retries an Ollama outage", () => {
    const down = Object.assign(new Error("Ollama is unreachable"), {
      name: "AIError",
      kind: "UNREACHABLE",
    });
    assert.equal(isRetryableEvaluationError(down, 1), true);
  });
});

describe("R-3 failure record", () => {
  const payload = evaluationFailurePayload({
    sessionId: SESSION,
    kind: "INTERVIEW_OVERALL",
    attempts: MAX_EVALUATION_ATTEMPTS,
    error: new Error("connect ECONNREFUSED 127.0.0.1:11434"),
  });

  it("is explicitly marked failed", () => {
    assert.equal(payload.status, "failed");
    assert.equal(payload.kind, "INTERVIEW_OVERALL");
    assert.equal(payload.sessionId, SESSION);
  });

  it("records how many attempts were made", () => {
    assert.equal(payload.attempts, MAX_EVALUATION_ATTEMPTS);
  });

  it("stays advisory-only, like every other AI signal", () => {
    assert.equal(payload.advisoryOnly, true);
  });

  it("FABRICATES NOTHING", () => {
    const raw = JSON.stringify(payload);
    for (const forbidden of ["overall", "score", "recommendation", "reasoning", "confidence"]) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(payload, forbidden),
        `failure payload must not carry "${forbidden}" — found in ${raw}`,
      );
    }
  });

  it("keeps a short operator-facing reason", () => {
    const message = payload.error ?? "";
    assert.ok(message.length > 0);
    assert.ok(message.length <= 300, "error text must not become a transcript dump");
  });

  it("uses the same timeline kind the UI reads", () => {
    assert.equal(AI_EVALUATION_TIMELINE_KIND, "AI_EVALUATION");
  });
});

describe("R-3 error redaction", () => {
  it("keeps the failure legible", () => {
    assert.match(redactEvaluationError(new Error("The operation timed out")), /timed out/i);
  });

  it("truncates long model output", () => {
    const long = new Error("x".repeat(5000));
    assert.ok(redactEvaluationError(long).length <= 300);
  });

  it("handles non-Error throws", () => {
    assert.ok(redactEvaluationError("plain string").length > 0);
    assert.ok(redactEvaluationError(undefined).length > 0);
  });
});

describe("R-3 success record", () => {
  const payload = evaluationSuccessPayload({
    sessionId: SESSION,
    kind: "INTERVIEW_OVERALL",
    overall: 75,
    recommendation: "YES",
  });

  it("is explicitly marked completed", () => {
    assert.equal(payload.status, "completed");
  });

  it("remains advisory-only", () => {
    assert.equal(payload.advisoryOnly, true);
  });

  it("carries the real values it was given", () => {
    assert.equal(payload.overall, 75);
    assert.equal(payload.recommendation, "YES");
  });
});

describe("R-3 state derivation — pending vs failed vs completed", () => {
  const failed = { status: "failed", kind: "INTERVIEW_OVERALL", attempts: 2, error: "timed out" };
  const completed = { status: "completed", kind: "INTERVIEW_OVERALL" };

  it("an interview still in progress is not awaiting an evaluation yet", () => {
    assert.equal(
      deriveEvaluationState({ sessionStatus: "IN_PROGRESS", hasOverall: false, latestEvent: null }).state,
      "not_applicable",
    );
  });

  it("completed interview, evaluation present -> completed", () => {
    assert.equal(
      deriveEvaluationState({ sessionStatus: "COMPLETED", hasOverall: true, latestEvent: null }).state,
      "completed",
    );
  });

  it("completed interview, nothing yet, no failure -> PENDING, not failed", () => {
    // This is the false alarm the audit saw: generation legitimately takes ~2 min.
    const s = deriveEvaluationState({
      sessionStatus: "COMPLETED",
      hasOverall: false,
      latestEvent: null,
    });
    assert.equal(s.state, "pending");
    assert.equal(s.canRetry, true, "an operator may still force it");
  });

  it("completed interview, failure recorded -> FAILED", () => {
    const s = deriveEvaluationState({
      sessionStatus: "COMPLETED",
      hasOverall: false,
      latestEvent: failed,
    });
    assert.equal(s.state, "failed");
    assert.equal(s.attempts, 2);
    assert.match(String(s.error), /timed out/);
    assert.equal(s.canRetry, true);
  });

  it("a later success supersedes an earlier failure", () => {
    const s = deriveEvaluationState({
      sessionStatus: "COMPLETED",
      hasOverall: true,
      latestEvent: failed,
    });
    assert.equal(s.state, "completed", "the evaluation exists; the old failure is history");
  });

  it("a completed timeline event with no evaluation row is still pending", () => {
    const s = deriveEvaluationState({
      sessionStatus: "COMPLETED",
      hasOverall: false,
      latestEvent: completed,
    });
    assert.equal(s.state, "pending");
  });

  it("terminated interviews are evaluated like completed ones", () => {
    assert.equal(
      deriveEvaluationState({ sessionStatus: "TERMINATED", hasOverall: false, latestEvent: failed }).state,
      "failed",
    );
  });

  it("NEVER invents a score in any state", () => {
    for (const sessionStatus of ["IN_PROGRESS", "COMPLETED", "TERMINATED"]) {
      for (const latestEvent of [null, failed, completed]) {
        for (const hasOverall of [true, false]) {
          const s = deriveEvaluationState({ sessionStatus, hasOverall, latestEvent });
          const raw = JSON.stringify(s);
          assert.ok(!/"overall":\s*\d/.test(raw), `state leaked a score: ${raw}`);
          assert.ok(!/"recommendation":/.test(raw), `state leaked a recommendation: ${raw}`);
        }
      }
    }
  });
});
