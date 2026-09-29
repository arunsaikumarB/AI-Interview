/**
 * The sandbox runner must not be a general-purpose compute endpoint:
 * unsigned, forged, stale, replayed or malformed requests are rejected (real HTTP).
 * A replay is a reused authenticated nonce — identical requests with distinct
 * nonces (even in the same second) are legitimate and must both execute.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { RUNNER_SECRET, RUNNER_URL, runnerAvailable, signedPost } from "./helpers";
import { newRunnerNonce, signRunnerRequest } from "../../src/lib/practical/runner-client";

const PAYLOAD = {
  language: "python",
  source: "print(1)\n",
  tests: [{ id: "t1", input: "" }],
  limits: { perTestTimeoutMs: 1000, memoryMb: 128, maxOutputBytes: 4096 },
};

const SQL_PATH = "/v1/sql/execute";
const SQL_BODY = JSON.stringify({
  taskKey: "sql-customers-per-city",
  taskVersion: 1,
  query: "SELECT 1 AS x",
  limits: { timeoutMs: 3000, maxRows: 500, maxResultBytes: 131072 },
});

const nowTs = () => String(Math.floor(Date.now() / 1000));
const sqlPost = (opts: Parameters<typeof signedPost>[2] = {}) => signedPost(SQL_PATH, null, { rawBody: SQL_BODY, ...opts });
const flipLastHex = (s: string) => s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");

before(async () => {
  assert.ok(await runnerAvailable(), "sandbox runner is not running — start it with `npm run sandbox:runner`");
});

describe("sandbox runner authentication (real HTTP)", () => {
  it("rejects unsigned requests", async () => {
    const res = await fetch(`${RUNNER_URL}/v1/code/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(PAYLOAD),
    });
    assert.equal(res.status, 401);
  });

  it("rejects a wrong secret, a tampered body and a stale timestamp", async () => {
    assert.equal((await signedPost("/v1/code/execute", PAYLOAD, { secret: "x".repeat(64) })).status, 401);
    const ts = nowTs();
    const nonce = newRunnerNonce();
    const sig = signRunnerRequest(RUNNER_SECRET, ts, nonce, "POST", "/v1/code/execute", JSON.stringify(PAYLOAD));
    const tampered = JSON.stringify({ ...PAYLOAD, source: "import os\nprint(os.environ)\n" });
    assert.equal((await signedPost("/v1/code/execute", null, { ts, nonce, rawBody: tampered, signature: sig })).status, 401);
    const stale = String(Math.floor(Date.now() / 1000) - 120);
    assert.equal((await signedPost("/v1/code/execute", PAYLOAD, { ts: stale })).status, 401);
  });

  it("1. accepts a valid signed request", async () => {
    const r = await sqlPost();
    assert.equal(r.status, 200);
    assert.equal(r.body?.status, "OK");
  });

  it("2. rejects the same request with the same nonce as a replay", async () => {
    const ts = nowTs();
    const nonce = newRunnerNonce();
    assert.equal((await sqlPost({ ts, nonce })).status, 200);
    assert.equal((await sqlPost({ ts, nonce })).status, 401);
  });

  it("3. accepts the same request with a different nonce", async () => {
    assert.equal((await sqlPost({ nonce: newRunnerNonce() })).status, 200);
    assert.equal((await sqlPost({ nonce: newRunnerNonce() })).status, 200);
  });

  it("4. accepts the same body and same timestamp with a different nonce", async () => {
    const ts = nowTs();
    const a = await sqlPost({ ts, nonce: newRunnerNonce() });
    const b = await sqlPost({ ts, nonce: newRunnerNonce() });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
  });

  it("5. rejects a different body reusing a consumed nonce", async () => {
    const nonce = newRunnerNonce();
    assert.equal((await sqlPost({ nonce })).status, 200);
    const otherBody = JSON.stringify({ ...JSON.parse(SQL_BODY), query: "SELECT 2 AS x" });
    assert.equal((await signedPost(SQL_PATH, null, { rawBody: otherBody, nonce })).status, 401);
  });

  it("6. rejects a nonce modified after signing", async () => {
    const nonce = newRunnerNonce();
    assert.equal((await sqlPost({ nonce, sentNonce: flipLastHex(nonce) })).status, 401);
    // the untouched original is still usable: the forged attempt did not consume it
    assert.equal((await sqlPost({ nonce })).status, 200);
  });

  it("7. rejects a timestamp modified after signing", async () => {
    const ts = nowTs();
    const nonce = newRunnerNonce();
    const sig = signRunnerRequest(RUNNER_SECRET, ts, nonce, "POST", SQL_PATH, SQL_BODY);
    assert.equal((await sqlPost({ ts: String(Number(ts) - 1), nonce, signature: sig })).status, 401);
  });

  it("8. rejects a modified signature", async () => {
    const ts = nowTs();
    const nonce = newRunnerNonce();
    const sig = signRunnerRequest(RUNNER_SECRET, ts, nonce, "POST", SQL_PATH, SQL_BODY);
    assert.equal((await sqlPost({ ts, nonce, signature: flipLastHex(sig) })).status, 401);
    assert.equal((await sqlPost({ ts, nonce, signature: "" })).status, 401);
  });

  it("9. rejects a request without a nonce", async () => {
    assert.equal((await sqlPost({ omitNonce: true })).status, 401);
  });

  it("10. rejects malformed nonces even when correctly signed", async () => {
    const bad = [
      "",
      "abc123",
      newRunnerNonce().toUpperCase(),
      newRunnerNonce().slice(0, 63),
      newRunnerNonce() + "0",
      "g".repeat(64),
      newRunnerNonce().slice(0, 62) + "\u00e9a",
    ];
    for (const nonce of bad) {
      assert.equal((await sqlPost({ nonce })).status, 401, `nonce ${JSON.stringify(nonce)} must be rejected`);
    }
  });

  it("11. rejects an expired timestamp", async () => {
    assert.equal((await sqlPost({ ts: String(Math.floor(Date.now() / 1000) - 31 - 2) })).status, 401);
  });

  it("12. rejects a future timestamp outside the window", async () => {
    assert.equal((await sqlPost({ ts: String(Math.floor(Date.now() / 1000) + 31 + 2) })).status, 401);
    assert.equal((await sqlPost({ ts: "9".repeat(13) })).status, 401);
    assert.equal((await sqlPost({ ts: "-1" })).status, 401);
  });

  it("13. accepts concurrent identical requests with different nonces", async () => {
    const ts = nowTs();
    const [a, b] = await Promise.all([sqlPost({ ts, nonce: newRunnerNonce() }), sqlPost({ ts, nonce: newRunnerNonce() })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body?.status, "OK");
    assert.equal(b.body?.status, "OK");
  });

  it("14. accepts only the first of concurrent exact replays (same nonce)", async () => {
    const ts = nowTs();
    const nonce = newRunnerNonce();
    const results = await Promise.all([1, 2, 3].map(() => sqlPost({ ts, nonce })));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 401, 401]);
  });

  it("regression: byte-identical SQL requests in the same second with different nonces both execute", async () => {
    const ts = nowTs();
    const nonceA = newRunnerNonce();
    const nonceB = newRunnerNonce();
    assert.notEqual(nonceA, nonceB);
    const a = await sqlPost({ ts, nonce: nonceA });
    const b = await sqlPost({ ts, nonce: nonceB });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body?.status, "OK");
    assert.equal(b.body?.status, "OK");
    assert.deepEqual(b.body?.columns, a.body?.columns);
    assert.deepEqual(b.body?.rows, a.body?.rows);
    const replayA = await sqlPost({ ts, nonce: nonceA });
    assert.equal(replayA.status, 401);
    assert.deepEqual(replayA.body, { error: "unauthorized" });
  });

  it("rejects unknown fields, unsupported languages, bad limits and unknown SQL tasks", async () => {
    assert.equal((await signedPost("/v1/code/execute", { ...PAYLOAD, image: "alpine" })).status, 400);
    assert.equal((await signedPost("/v1/code/execute", { ...PAYLOAD, language: "bash" })).status, 400);
    assert.equal((await signedPost("/v1/code/execute", { ...PAYLOAD, tests: [] })).status, 400);
    assert.equal(
      (await signedPost("/v1/sql/execute", { taskKey: "no-such-task", taskVersion: 1, query: "SELECT 1", limits: {} })).status,
      400,
    );
    assert.equal((await signedPost("/v1/other", PAYLOAD)).status, 404);
  });

  it("clamps oversized limits to the hard ceilings instead of honouring them", async () => {
    const r = await signedPost("/v1/code/execute", {
      ...PAYLOAD,
      source: "while True:\n    pass\n",
      limits: { perTestTimeoutMs: 600000, memoryMb: 100000, maxOutputBytes: 999999999 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body?.tests?.[0]?.outcome, "TIMEOUT");
    assert.ok(r.body?.tests?.[0]?.runtimeMs <= 6000, `ran ${r.body?.tests?.[0]?.runtimeMs} ms — ceiling is 5000`);
  });
});
