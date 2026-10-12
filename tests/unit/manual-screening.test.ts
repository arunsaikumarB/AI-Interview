import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIError } from "../../src/lib/ai/ollama";
import {
  SCREENING_GIVE_UP_MS,
  createManualScreeningRunner,
  fallbackScreeningStatus,
  parseScreeningSince,
  screeningFailureMessage,
} from "../../src/lib/ai/manual-screening";

describe("screening status when this process has no record of the run", () => {
  const now = Date.parse("2026-10-09T10:00:00.000Z");

  it("reads a valid start time and rejects bad, future or old ones", () => {
    assert.equal(parseScreeningSince("2026-10-09T09:59:00.000Z", now)?.toISOString(), "2026-10-09T09:59:00.000Z");
    assert.equal(parseScreeningSince(null, now), null);
    assert.equal(parseScreeningSince("not a date", now), null);
    assert.equal(parseScreeningSince("2026-10-09T10:05:00.000Z", now), null);
    assert.equal(parseScreeningSince("2026-10-07T10:00:00.000Z", now), null);
    assert.equal(parseScreeningSince("x".repeat(41), now), null);
  });

  it("is finished when a result was saved after the click", () => {
    const since = new Date(now - 90_000);
    assert.deepEqual(fallbackScreeningStatus({ since, resultSince: true, now }), { status: "COMPLETED" });
  });

  it("keeps waiting while it may still be running in another app process", () => {
    const since = new Date(now - 90_000);
    assert.deepEqual(fallbackScreeningStatus({ since, resultSince: false, now }), { status: "PROCESSING" });
  });

  it("reports not finished once the longest possible run has passed", () => {
    const since = new Date(now - SCREENING_GIVE_UP_MS - 1);
    const r = fallbackScreeningStatus({ since, resultSince: false, now });
    assert.equal(r.status, "FAILED");
    assert.match(r.error ?? "", /did not finish/);
  });

  it("without a start time, says nothing is running (old pages)", () => {
    const r = fallbackScreeningStatus({ since: null, resultSince: false, now });
    assert.equal(r.status, "FAILED");
    assert.match(r.error ?? "", /No screening is running/);
  });
});

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
