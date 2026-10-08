import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sweepIntervalMinutes, sweepOnce, type ScreeningSweepDeps } from "../../src/lib/ai/screening-sweep";

function fakeSweep(unscreened: string[], opts: { busyAfter?: number; queueRoom?: number; keep?: Set<string> } = {}) {
  const left = [...unscreened];
  const handed: string[] = [];
  let busyChecks = 0;
  let idleCalls = 0;
  const deps: ScreeningSweepDeps = {
    next: async () => left[0] ?? null,
    enqueue: (id) => {
      if (opts.queueRoom !== undefined && handed.length >= opts.queueRoom) return false;
      handed.push(id);
      return true;
    },
    queueIdle: async () => {
      idleCalls++;
      const id = handed[handed.length - 1];
      // Screened (or failed and recorded) unless it is one that keeps giving way.
      if (!opts.keep?.has(id)) left.splice(left.indexOf(id), 1);
    },
    busy: async () => opts.busyAfter !== undefined && busyChecks++ >= opts.busyAfter,
  };
  return { deps, handed, idleCalls: () => idleCalls };
}

describe("screening sweep", () => {
  it("hands every unscreened application over one at a time, waiting for each", async () => {
    const f = fakeSweep(["new", "older", "oldest"]);
    assert.equal(await sweepOnce(f.deps), 3);
    assert.deepEqual(f.handed, ["new", "older", "oldest"]);
    assert.equal(f.idleCalls(), 3);
  });

  it("does nothing when there is nothing to screen", async () => {
    const f = fakeSweep([]);
    assert.equal(await sweepOnce(f.deps), 0);
    assert.deepEqual(f.handed, []);
  });

  it("stops as soon as the AI is needed elsewhere", async () => {
    const f = fakeSweep(["a", "b", "c"], { busyAfter: 1 });
    assert.equal(await sweepOnce(f.deps), 1);
    assert.deepEqual(f.handed, ["a"]);
  });

  it("does not start when the AI is busy", async () => {
    const f = fakeSweep(["a"], { busyAfter: 0 });
    assert.equal(await sweepOnce(f.deps), 0);
  });

  it("stops the pass when the same application comes back (gave way to other AI)", async () => {
    const f = fakeSweep(["a", "b"], { keep: new Set(["a"]) });
    assert.equal(await sweepOnce(f.deps), 1);
    assert.deepEqual(f.handed, ["a"]);
  });

  it("stops when the automatic queue is full", async () => {
    const f = fakeSweep(["a", "b"], { queueRoom: 0 });
    assert.equal(await sweepOnce(f.deps), 0);
  });

  it("caps one pass", async () => {
    const f = fakeSweep(["a", "b", "c", "d"]);
    assert.equal(await sweepOnce(f.deps, 2), 2);
    assert.deepEqual(f.handed, ["a", "b"]);
  });

  it("is on every 2 minutes in production and off in development unless configured", () => {
    assert.equal(sweepIntervalMinutes({ NODE_ENV: "production" }), 2);
    assert.equal(sweepIntervalMinutes({ NODE_ENV: "development" }), 0);
    assert.equal(sweepIntervalMinutes({ NODE_ENV: "development", AUTO_SCREENING_SWEEP_MINUTES: "5" }), 5);
    assert.equal(sweepIntervalMinutes({ NODE_ENV: "production", AUTO_SCREENING_SWEEP_MINUTES: "0" }), 0);
    assert.equal(sweepIntervalMinutes({ NODE_ENV: "production", AUTO_SCREENING_SWEEP_MINUTES: "999" }), 60);
    assert.equal(sweepIntervalMinutes({ NODE_ENV: "production", AUTO_SCREENING_SWEEP_MINUTES: "abc" }), 2);
    assert.equal(sweepIntervalMinutes({ NODE_ENV: "production", AUTO_SCREENING_SWEEP_MINUTES: "-1" }), 2);
  });
});
