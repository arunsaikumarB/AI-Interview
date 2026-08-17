/**
 * R-10 — Secure attribute on the authentication cookie.
 *
 * The audit observed `Secure` absent on plain-HTTP localhost, which is correct
 * for development but left one real gap: the LAN pilot serves the candidate
 * and secondary-camera pages over HTTPS on :3443 through
 * scripts/lan-https-proxy.mjs (which sets x-forwarded-proto: https) while the
 * Next process itself is NODE_ENV=development. In that configuration a session
 * cookie was issued without Secure over a TLS connection.
 *
 * Rule under test: Secure whenever the request is HTTPS, and always in
 * production — never forced on plain-HTTP localhost, which would make
 * development login impossible.
 *
 *   npx tsx --test tests/unit/session-cookie.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sessionCookieOptions } from "../../src/lib/auth/cookie-options";

const opts = (o: Parameters<typeof sessionCookieOptions>[0]) => sessionCookieOptions(o);

describe("R-10 Secure attribute", () => {
  it("production over HTTPS -> Secure", () => {
    assert.equal(opts({ isProduction: true, isHttps: true, ttlHours: 12 }).secure, true);
  });

  it("production is Secure even if the proto header is missing", () => {
    // A production deployment behind a proxy that forgets x-forwarded-proto
    // must not silently downgrade to a non-Secure cookie.
    assert.equal(opts({ isProduction: true, isHttps: false, ttlHours: 12 }).secure, true);
  });

  it("REGRESSION: development over LAN HTTPS -> Secure", () => {
    // This is the gap R-10 closes: the :3443 pilot proxy.
    assert.equal(opts({ isProduction: false, isHttps: true, ttlHours: 12 }).secure, true);
  });

  it("development over plain HTTP localhost -> not Secure, so login still works", () => {
    assert.equal(opts({ isProduction: false, isHttps: false, ttlHours: 12 }).secure, false);
  });
});

describe("R-10 the rest of the cookie contract is unchanged", () => {
  const o = opts({ isProduction: true, isHttps: true, ttlHours: 12 });

  it("stays HttpOnly", () => {
    assert.equal(o.httpOnly, true);
  });

  it("stays SameSite=lax", () => {
    // Lax, not Strict: the candidate magic link is a cross-site top-level
    // navigation and Strict would drop the cookie on arrival.
    assert.equal(o.sameSite, "lax");
  });

  it("stays scoped to the whole app", () => {
    assert.equal(o.path, "/");
  });

  it("carries no domain, so the cookie is host-only", () => {
    assert.ok(!("domain" in o) || o.domain === undefined);
  });

  it("honours the configured TTL", () => {
    assert.equal(opts({ isProduction: true, isHttps: true, ttlHours: 12 }).maxAge, 12 * 3600);
    assert.equal(opts({ isProduction: true, isHttps: true, ttlHours: 1 }).maxAge, 3600);
  });
});

describe("R-10 clearing the cookie must match how it was set", () => {
  it("deletion options mirror the Secure/SameSite/path of the live cookie", () => {
    const set = opts({ isProduction: true, isHttps: true, ttlHours: 12 });
    const clear = sessionCookieOptions({
      isProduction: true,
      isHttps: true,
      ttlHours: 12,
      expire: true,
    });
    assert.equal(clear.secure, set.secure);
    assert.equal(clear.sameSite, set.sameSite);
    assert.equal(clear.path, set.path);
    assert.equal(clear.httpOnly, set.httpOnly);
    assert.equal(clear.maxAge, 0, "expiring the cookie means maxAge 0");
  });
});

describe("R-10 proto detection", () => {
  it("trusts x-forwarded-proto from the LAN pilot proxy", async () => {
    const { requestIsHttps } = await import("../../src/lib/security-headers");
    assert.equal(requestIsHttps({ forwardedProto: "https" }), true);
    assert.equal(requestIsHttps({ forwardedProto: "http" }), false);
  });

  it("takes the first hop of a proxy chain", async () => {
    const { requestIsHttps } = await import("../../src/lib/security-headers");
    assert.equal(requestIsHttps({ forwardedProto: "https, http" }), true);
    assert.equal(requestIsHttps({ forwardedProto: "http, https" }), false);
  });

  it("falls back to the request URL when no header is present", async () => {
    const { requestIsHttps } = await import("../../src/lib/security-headers");
    assert.equal(requestIsHttps({ url: "https://192.168.1.8:3443/login" }), true);
    assert.equal(requestIsHttps({ url: "http://localhost:3000/login" }), false);
  });

  it("defaults to not-HTTPS when it cannot tell", async () => {
    const { requestIsHttps } = await import("../../src/lib/security-headers");
    assert.equal(requestIsHttps({}), false);
    assert.equal(requestIsHttps({ url: "not a url" }), false);
  });
});
