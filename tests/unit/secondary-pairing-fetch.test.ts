import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SECONDARY_NETWORK_MESSAGE,
  SECONDARY_NOT_FOUND_MESSAGE,
  SECONDARY_SERVER_MESSAGE,
  SECONDARY_TIMEOUT_MESSAGE,
  fetchSecondaryJson,
} from "../../src/lib/secondary-pairing-fetch";

const respond =
  (body: string, status: number, type = "application/json"): typeof fetch =>
  async () =>
    new Response(body, { status, headers: { "content-type": type } });

describe("fetchSecondaryJson", () => {
  it("returns parsed data on success", async () => {
    const r = await fetchSecondaryJson<{ jobTitle: string }>("/x", undefined, {
      fetchImpl: respond(JSON.stringify({ jobTitle: "QA" }), 200),
    });
    assert.deepEqual(r, { ok: true, data: { jobTitle: "QA" } });
  });

  it("unknown pairing code is a clear, non-retryable error", async () => {
    const r = await fetchSecondaryJson("/x", undefined, {
      fetchImpl: respond(JSON.stringify({ error: "Pairing code not found" }), 404),
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.message, SECONDARY_NOT_FOUND_MESSAGE);
    assert.equal(r.retryable, false);
  });

  it("expired code shows the server's message and is not retryable", async () => {
    const msg = "This pairing code has expired. Ask for a new QR code.";
    const r = await fetchSecondaryJson("/x", undefined, {
      fetchImpl: respond(JSON.stringify({ error: msg }), 410),
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.message, msg);
    assert.equal(r.retryable, false);
  });

  it("server errors and proxy HTML pages are retryable with a generic message", async () => {
    for (const fetchImpl of [
      respond(JSON.stringify({ error: "stack trace at /opt/hireos" }), 500),
      respond("<html>502 Bad Gateway</html>", 502, "text/html"),
      respond("<html>maintenance</html>", 200, "text/html"),
      respond("null", 200),
      respond(JSON.stringify({ error: "Too many requests" }), 429),
    ]) {
      const r = await fetchSecondaryJson("/x", undefined, { fetchImpl });
      assert.equal(r.ok, false);
      if (r.ok) continue;
      assert.equal(r.message, SECONDARY_SERVER_MESSAGE);
      assert.equal(r.retryable, true);
    }
  });

  it("network failure is retryable", async () => {
    const r = await fetchSecondaryJson("/x", undefined, {
      fetchImpl: async () => {
        throw new TypeError("Load failed");
      },
    });
    assert.deepEqual(r, { ok: false, status: null, message: SECONDARY_NETWORK_MESSAGE, retryable: true });
  });

  it("times out instead of hanging", async () => {
    const r = await fetchSecondaryJson("/x", undefined, {
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    });
    assert.deepEqual(r, { ok: false, status: null, message: SECONDARY_TIMEOUT_MESSAGE, retryable: true });
  });
});
