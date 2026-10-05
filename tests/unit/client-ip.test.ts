import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clientIp, resolveClientIp, trustedProxyCount } from "../../src/lib/security/client-ip";

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe("trustedProxyCount", () => {
  it("is off by default and for false/0", () => {
    assert.equal(trustedProxyCount(undefined), 0);
    assert.equal(trustedProxyCount(""), 0);
    assert.equal(trustedProxyCount("false"), 0);
    assert.equal(trustedProxyCount("0"), 0);
  });

  it("accepts true and small hop counts", () => {
    assert.equal(trustedProxyCount("true"), 1);
    assert.equal(trustedProxyCount("1"), 1);
    assert.equal(trustedProxyCount(" 2 "), 2);
  });

  it("fails closed on anything else", () => {
    for (const v of ["yes", "-1", "1.5", "6", "loopback", "10.0.0.1"]) {
      assert.equal(trustedProxyCount(v), 0, v);
    }
  });
});

describe("resolveClientIp", () => {
  it("direct request without forwarded headers has no client IP", () => {
    assert.equal(resolveClientIp(headers(), 0), null);
  });

  it("direct request ignores a spoofed X-Forwarded-For and X-Real-IP", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10" });
    assert.equal(resolveClientIp(h, 0), null);
  });

  it("behind one trusted proxy uses the address that proxy appended", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.7" }), 1), "198.51.100.7");
  });

  it("with multiple values ignores entries the client sent", () => {
    const h = headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 198.51.100.7" });
    assert.equal(resolveClientIp(h, 1), "198.51.100.7");
    assert.equal(resolveClientIp(h, 2), "5.6.7.8");
  });

  it("returns null when the chain is shorter than the trusted hops", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "198.51.100.7" }), 2), null);
  });

  it("rejects values that are not IP addresses", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.2.3.4, evil" }), 1), null);
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.2.3.4," }), 1), null);
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.2.3.4:5555" }), 1), null);
  });

  it("accepts IPv6, bracketed or not", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "2001:DB8::1" }), 1), "2001:db8::1");
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "[2001:db8::2]" }), 1), "2001:db8::2");
  });

  it("never reads X-Real-IP", () => {
    assert.equal(resolveClientIp(headers({ "x-real-ip": "198.51.100.7" }), 1), null);
  });
});

describe("clientIp", () => {
  it("follows TRUST_PROXY from the environment", () => {
    const saved = process.env.TRUST_PROXY;
    const req = new Request("http://localhost/api/careers/apply", {
      headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.7" },
    });
    try {
      delete process.env.TRUST_PROXY;
      assert.equal(clientIp(req), null);
      process.env.TRUST_PROXY = "false";
      assert.equal(clientIp(req), null);
      process.env.TRUST_PROXY = "1";
      assert.equal(clientIp(req), "198.51.100.7");
    } finally {
      if (saved === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = saved;
    }
  });
});
