import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAutoScreeningQueue, type AutoScreeningDeps } from "../../src/lib/ai/auto-screening";
import { humanTimelineTitle } from "../../src/lib/candidate-detail-ui";

function fakeDeps(fail: Set<string> = new Set()) {
  const screened: string[] = [];
  const failures: Array<{ id: string; code: string }> = [];
  let running = 0;
  let maxRunning = 0;
  const deps: AutoScreeningDeps = {
    screen: async (id) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (fail.has(id)) throw Object.assign(new Error("model down"), { code: "OLLAMA_UNREACHABLE" });
      screened.push(id);
    },
    recordFailure: async (id, code) => {
      failures.push({ id, code });
    },
  };
  return { deps, screened, failures, maxRunning: () => maxRunning };
}

describe("auto screening queue", () => {
  it("screens one application at a time, in order", async () => {
    const f = fakeDeps();
    const q = createAutoScreeningQueue(async () => f.deps);
    assert.equal(q.enqueue("a"), true);
    assert.equal(q.enqueue("b"), true);
    assert.equal(q.enqueue("c"), true);
    await q.idle();
    assert.deepEqual(f.screened, ["a", "b", "c"]);
    assert.equal(f.maxRunning(), 1);
  });

  it("records a failure with only the error code and keeps going", async () => {
    const f = fakeDeps(new Set(["b"]));
    const q = createAutoScreeningQueue(async () => f.deps);
    q.enqueue("a");
    q.enqueue("b");
    q.enqueue("c");
    await q.idle();
    assert.deepEqual(f.screened, ["a", "c"]);
    assert.deepEqual(f.failures, [{ id: "b", code: "OLLAMA_UNREACHABLE" }]);
  });

  it("does not throw when recording the failure itself fails", async () => {
    const f = fakeDeps(new Set(["a"]));
    f.deps.recordFailure = async () => {
      throw new Error("db down");
    };
    const q = createAutoScreeningQueue(async () => f.deps);
    q.enqueue("a");
    q.enqueue("b");
    await q.idle();
    assert.deepEqual(f.screened, ["b"]);
  });

  it("caps the waiting list and ignores duplicates", async () => {
    const f = fakeDeps();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = createAutoScreeningQueue(async () => {
      await gate;
      return f.deps;
    }, 2);
    assert.equal(q.enqueue("a"), true);
    assert.equal(q.enqueue("a"), true);
    assert.equal(q.enqueue("b"), true);
    assert.equal(q.enqueue("c"), false);
    release();
    await q.idle();
    assert.deepEqual(f.screened, ["a", "b"]);
    assert.equal(q.enqueue("d"), true);
    await q.idle();
    assert.deepEqual(f.screened, ["a", "b", "d"]);
  });

  it("does not leak error messages as the code", async () => {
    const f = fakeDeps();
    f.deps.screen = async () => {
      throw Object.assign(new Error("Ollama at http://10.0.0.1 said no"), { code: "not a code; DROP" });
    };
    const q = createAutoScreeningQueue(async () => f.deps);
    q.enqueue("a");
    await q.idle();
    assert.deepEqual(f.failures, [{ id: "a", code: "Error" }]);
  });

  it("does not record a run that gave way to foreground AI as a failure", async () => {
    const f = fakeDeps();
    f.deps.screen = async (id) => {
      if (id === "a") throw Object.assign(new Error("gave way"), { code: "PREEMPTED" });
      f.screened.push(id);
    };
    const q = createAutoScreeningQueue(async () => f.deps);
    q.enqueue("a");
    q.enqueue("b");
    await q.idle();
    assert.deepEqual(f.screened, ["b"]);
    assert.deepEqual(f.failures, []);
  });

  it("waits for free AI capacity before each screening", async () => {
    const f = fakeDeps();
    const order: string[] = [];
    const screen = f.deps.screen;
    f.deps.screen = async (id) => {
      order.push(`screen:${id}`);
      await screen(id);
    };
    f.deps.waitForCapacity = async () => {
      order.push("wait");
      await new Promise((r) => setTimeout(r, 2));
    };
    const q = createAutoScreeningQueue(async () => f.deps);
    q.enqueue("a");
    q.enqueue("b");
    await q.idle();
    assert.deepEqual(order, ["wait", "screen:a", "wait", "screen:b"]);
  });

  it("still screens when the capacity check itself throws", async () => {
    const f = fakeDeps();
    f.deps.waitForCapacity = async () => {
      throw new Error("db down");
    };
    const q = createAutoScreeningQueue(async () => f.deps);
    q.enqueue("a");
    await q.idle();
    assert.deepEqual(f.screened, ["a"]);
  });

  it("shows a clear timeline title for a failed automatic screening", () => {
    assert.equal(
      humanTimelineTitle("OTHER", { kind: "ai_screening_failed" }),
      "Automatic AI screening did not finish (run it again from this page)",
    );
  });
});
