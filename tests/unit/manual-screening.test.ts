import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIError } from "../../src/lib/ai/ollama";
import { createManualScreeningRunner, screeningFailureMessage } from "../../src/lib/ai/manual-screening";

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("manual screening runner", () => {
  it("runs in the background and reports PROCESSING, then COMPLETED", async () => {
    const d = deferred();
    const runner = createManualScreeningRunner(() => d.promise);
    assert.equal(runner.start("a1"), "QUEUED");
    assert.deepEqual(runner.status("a1"), { status: "PROCESSING" });
    d.resolve();
    await runner.idle();
    assert.deepEqual(runner.status("a1"), { status: "COMPLETED" });
  });

  it("a second click while running does not start another AI call", async () => {
    const d = deferred();
    let calls = 0;
    const runner = createManualScreeningRunner(() => {
      calls++;
      return d.promise;
    });
    runner.start("a1");
    assert.equal(runner.start("a1"), "ALREADY_PROCESSING");
    d.resolve();
    await runner.idle();
    assert.equal(calls, 1);
    assert.equal(runner.start("a1"), "QUEUED");
    await runner.idle();
    assert.equal(calls, 2);
  });

  it("refuses more than the running limit", async () => {
    const d = deferred();
    const runner = createManualScreeningRunner(() => d.promise, Date.now, 2);
    assert.equal(runner.start("a1"), "QUEUED");
    assert.equal(runner.start("a2"), "QUEUED");
    assert.equal(runner.start("a3"), "BUSY");
    assert.equal(runner.status("a3"), null);
    d.resolve();
    await runner.idle();
    assert.equal(runner.start("a3"), "QUEUED");
    await runner.idle();
  });

  it("a failure is reported honestly without internal details", async () => {
    const runner = createManualScreeningRunner(async () => {
      throw new AIError("OLLAMA_UNREACHABLE", "Ollama timed out after 240s at http://127.0.0.1:11434.");
    });
    runner.start("a1");
    await runner.idle();
    const s = runner.status("a1");
    assert.equal(s?.status, "FAILED");
    assert.doesNotMatch(s?.error ?? "", /127\.0\.0\.1|11434|http/);
  });

  it("forgets finished runs after 10 minutes", async () => {
    let t = 1_000_000;
    const runner = createManualScreeningRunner(async () => undefined, () => t);
    runner.start("a1");
    await runner.idle();
    assert.equal(runner.status("a1")?.status, "COMPLETED");
    t += 11 * 60 * 1000;
    assert.equal(runner.status("a1"), null);
  });
});

describe("screeningFailureMessage", () => {
  it("passes validation messages through and hides the rest", () => {
    assert.equal(
      screeningFailureMessage(new AIError("VALIDATION", "No resume text available for this candidate.")),
      "No resume text available for this candidate.",
    );
    assert.match(screeningFailureMessage(new AIError("OLLAMA_HTTP", "500 from http://x")), /too busy/);
    assert.match(screeningFailureMessage(new AIError("INVALID_JSON", "bad")), /could not be read/);
    assert.equal(screeningFailureMessage(new Error("connect ECONNREFUSED 10.0.12.219:5432")), "Screening failed. Try again.");
  });
});
