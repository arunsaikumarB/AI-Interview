import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  rateLimit,
  rateLimitBucketCountForTests,
  sweepRateLimitBucketsForTests,
} from "../../src/lib/rate-limit";

describe("rateLimit", () => {
  it("blocks after the limit within the window", () => {
    const key = `rl-test:block:${Math.random()}`;
    assert.equal(rateLimit({ key, limit: 2, windowMs: 60_000 }).ok, true);
    assert.equal(rateLimit({ key, limit: 2, windowMs: 60_000 }).ok, true);
    assert.deepEqual(rateLimit({ key, limit: 2, windowMs: 60_000 }), {
      ok: false,
      remaining: 0,
    });
  });

  it("sweep drops keys whose window has passed and keeps active ones", () => {
    const expired = `rl-test:expired:${Math.random()}`;
    const active = `rl-test:active:${Math.random()}`;
    rateLimit({ key: expired, limit: 5, windowMs: 1_000 });
    rateLimit({ key: active, limit: 5, windowMs: 3_600_000 });
    const before = rateLimitBucketCountForTests();

    sweepRateLimitBucketsForTests(Date.now() + 2_000);

    assert.equal(rateLimitBucketCountForTests(), before - 1);
    assert.equal(rateLimit({ key: active, limit: 2, windowMs: 3_600_000 }).ok, true);
    assert.equal(rateLimit({ key: active, limit: 2, windowMs: 3_600_000 }).ok, false);
  });
});
