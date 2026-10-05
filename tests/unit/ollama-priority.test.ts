import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { z } from "zod";
import { AIError, chatJSON, foregroundChatBusy } from "../../src/lib/ai/ollama";

const Shape = z.object({ ok: z.boolean() });
const realFetch = globalThis.fetch;

type Pending = { signal: AbortSignal | null | undefined; resolve: () => void };

/** Fake Ollama that answers only when told to, and honours abort like real fetch. */
function fakeOllama() {
  const pending: Pending[] = [];
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const abort = () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort);
      pending.push({
        signal,
        resolve: () =>
          resolve(new Response(JSON.stringify({ model: "test", message: { content: '{"ok":true}' } }), { status: 200 })),
      });
    })) as typeof fetch;
  return pending;
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(check());
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Ollama foreground priority", () => {
  it("a foreground call cancels a running background call and gets the model", async () => {
    const pending = fakeOllama();
    const background = chatJSON("s", "u", Shape, { background: true });
    await until(() => pending.length === 1);

    const foreground = chatJSON("s", "u", Shape);
    await assert.rejects(background, (err: unknown) => err instanceof AIError && err.code === "PREEMPTED");
    assert.equal(pending[0].signal?.aborted, true);

    await until(() => pending.length === 2);
    assert.equal(foregroundChatBusy(0), true);
    pending[1].resolve();
    assert.deepEqual((await foreground).data, { ok: true });
    assert.equal(foregroundChatBusy(0), false);
    assert.equal(foregroundChatBusy(60_000), true, "stays busy for the quiet window");
  });

  it("a background call does not start while a foreground call is running", async () => {
    const pending = fakeOllama();
    const foreground = chatJSON("s", "u", Shape);
    await until(() => pending.length === 1);
    await assert.rejects(
      chatJSON("s", "u", Shape, { background: true }),
      (err: unknown) => err instanceof AIError && err.code === "PREEMPTED",
    );
    assert.equal(pending.length, 1, "no background request reached Ollama");
    pending[0].resolve();
    await foreground;
  });

  it("foreground calls never cancel each other", async () => {
    const pending = fakeOllama();
    const a = chatJSON("s", "u", Shape);
    await until(() => pending.length === 1);
    const b = chatJSON("s", "u", Shape);
    await until(() => pending.length === 2);
    assert.equal(pending[0].signal?.aborted, false);
    pending[0].resolve();
    pending[1].resolve();
    assert.deepEqual((await a).data, { ok: true });
    assert.deepEqual((await b).data, { ok: true });
  });

  it("a background timeout is still reported as a timeout, not a preemption", async () => {
    fakeOllama();
    await assert.rejects(
      chatJSON("s", "u", Shape, { background: true, timeoutMs: 20 }),
      (err: unknown) => err instanceof AIError && err.code === "OLLAMA_UNREACHABLE" && /timed out/.test(err.message),
    );
  });
});
