/**
 * The sandbox runner must not be a general-purpose compute endpoint:
 * unsigned, forged, stale, replayed or malformed requests are rejected (real HTTP).
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { RUNNER_SECRET, RUNNER_URL, runnerAvailable, signedPost } from "./helpers";
import { signRunnerRequest } from "../../src/lib/practical/runner-client";

const PAYLOAD = {
  language: "python",
  source: "print(1)\n",
  tests: [{ id: "t1", input: "" }],
  limits: { perTestTimeoutMs: 1000, memoryMb: 128, maxOutputBytes: 4096 },
};

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
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signRunnerRequest(RUNNER_SECRET, ts, "POST", "/v1/code/execute", JSON.stringify(PAYLOAD));
    const tampered = JSON.stringify({ ...PAYLOAD, source: "import os\nprint(os.environ)\n" });
    assert.equal((await signedPost("/v1/code/execute", null, { ts, rawBody: tampered, signature: sig })).status, 401);
    const stale = String(Math.floor(Date.now() / 1000) - 120);
    assert.equal((await signedPost("/v1/code/execute", PAYLOAD, { ts: stale })).status, 401);
  });

  it("rejects replayed signatures", async () => {
    const body = JSON.stringify(PAYLOAD);
    const ts = String(Math.floor(Date.now() / 1000));
    const first = await signedPost("/v1/code/execute", null, { rawBody: body, ts });
    assert.equal(first.status, 200);
    const replay = await signedPost("/v1/code/execute", null, { rawBody: body, ts });
    assert.equal(replay.status, 401);
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
