/**
 * R-1 — production security headers.
 *
 * The audit found no CSP, no X-Frame-Options and no HSTS on any response.
 * These tests pin the policy so it cannot silently regress, and — just as
 * importantly — they pin the things the policy must NOT break:
 *
 *   - MediaPipe runs WebAssembly from same-origin /mediapipe/wasm  -> wasm-unsafe-eval
 *   - The pairing QR is a data: URL                                -> img-src data:
 *   - Recorded audio/video is played from blob:                    -> media-src blob:
 *   - The interview room needs camera + microphone                 -> Permissions-Policy self
 *   - Next dev HMR uses eval and a websocket                       -> dev-only relaxations
 *   - Plain-HTTP deployments must not be forced to upgrade         -> HSTS only over HTTPS
 *
 *   npx tsx --test tests/unit/security-headers.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STATIC_ASSET_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  createNonce,
} from "../../src/lib/security-headers";

/** Parse a CSP string into directive -> sources. */
function parse(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    out[tokens[0]] = tokens.slice(1);
  }
  return out;
}

const prod = (over: Partial<Parameters<typeof buildSecurityHeaders>[0]> = {}) =>
  buildSecurityHeaders({ isProduction: true, isHttps: true, nonce: "TESTNONCE", ...over });
const dev = (over: Partial<Parameters<typeof buildSecurityHeaders>[0]> = {}) =>
  buildSecurityHeaders({ isProduction: false, isHttps: false, nonce: "TESTNONCE", ...over });

describe("R-1 nonce generation", () => {
  it("produces a fresh, sufficiently long value each call", () => {
    const a = createNonce();
    const b = createNonce();
    assert.notEqual(a, b, "a nonce must never repeat across requests");
    assert.ok(a.length >= 16, `nonce too short: ${a.length}`);
    assert.match(a, /^[A-Za-z0-9+/=_-]+$/, "nonce must be header-safe");
  });
});

describe("R-1 CSP — production", () => {
  const csp = parse(buildContentSecurityPolicy({ isProduction: true, isHttps: true, nonce: "N1" }));

  it("defaults to self", () => {
    assert.deepEqual(csp["default-src"], ["'self'"]);
  });

  it("allows same-origin and nonce'd scripts but not arbitrary inline script", () => {
    assert.ok(csp["script-src"].includes("'self'"));
    assert.ok(csp["script-src"].includes("'nonce-N1'"));
    assert.ok(
      !csp["script-src"].includes("'unsafe-inline'"),
      "production must not allow unsafe-inline script",
    );
    assert.ok(
      !csp["script-src"].includes("'unsafe-eval'"),
      "production must not allow unsafe-eval",
    );
  });

  it("allows WebAssembly so MediaPipe keeps working", () => {
    assert.ok(
      csp["script-src"].includes("'wasm-unsafe-eval'"),
      "MediaPipe tasks-vision cannot instantiate its .wasm without this",
    );
  });

  it("allows data: images so the pairing QR renders", () => {
    assert.ok(csp["img-src"].includes("data:"));
    assert.ok(csp["img-src"].includes("'self'"));
  });

  it("allows blob: media so recordings and TTS play back", () => {
    assert.ok(csp["media-src"].includes("blob:"));
  });

  it("allows blob: workers", () => {
    assert.ok(csp["worker-src"].includes("blob:"));
  });

  it("locks down the dangerous directives", () => {
    assert.deepEqual(csp["object-src"], ["'none'"]);
    assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
    assert.deepEqual(csp["base-uri"], ["'self'"]);
    assert.deepEqual(csp["form-action"], ["'self'"]);
  });

  it("restricts network egress to the app's own origin", () => {
    assert.deepEqual(csp["connect-src"], ["'self'"]);
  });

  it("upgrades insecure requests only when the request itself is HTTPS", () => {
    assert.ok("upgrade-insecure-requests" in csp);
    const overHttp = parse(
      buildContentSecurityPolicy({ isProduction: true, isHttps: false, nonce: "N1" }),
    );
    assert.ok(
      !("upgrade-insecure-requests" in overHttp),
      "a plain-HTTP LAN deployment must not be told to upgrade every subresource",
    );
  });
});

describe("R-1 CSP — development must keep working", () => {
  const csp = parse(buildContentSecurityPolicy({ isProduction: false, isHttps: false, nonce: "N1" }));

  it("allows eval for React Refresh / HMR", () => {
    assert.ok(csp["script-src"].includes("'unsafe-eval'"));
  });

  it("allows the HMR websocket", () => {
    assert.ok(csp["connect-src"].some((s) => s === "ws:" || s === "wss:"));
  });

  it("still forbids framing and object embedding in development", () => {
    assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
    assert.deepEqual(csp["object-src"], ["'none'"]);
  });
});

describe("R-1 CSP — styles", () => {
  it("permits inline styles, which Next and React require", () => {
    const csp = parse(buildContentSecurityPolicy({ isProduction: true, isHttps: true, nonce: "N1" }));
    assert.ok(csp["style-src"].includes("'unsafe-inline'"));
    assert.ok(csp["style-src"].includes("'self'"));
  });
});

describe("R-1 header set", () => {
  it("sets the full set in production over HTTPS", () => {
    const h = prod();
    assert.equal(h["X-Frame-Options"], "DENY");
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.equal(h["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.ok(h["Content-Security-Policy"].includes("'nonce-TESTNONCE'"));
    assert.ok(h["Strict-Transport-Security"].includes("max-age="));
  });

  it("HSTS is sent only over HTTPS", () => {
    assert.ok(!("Strict-Transport-Security" in prod({ isHttps: false })));
    assert.ok(!("Strict-Transport-Security" in dev()));
  });

  it("HSTS max-age is at least six months and covers subdomains", () => {
    const hsts = prod()["Strict-Transport-Security"];
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
    assert.ok(maxAge >= 15_552_000, `max-age too low: ${maxAge}`);
    assert.ok(hsts.includes("includeSubDomains"));
  });

  it("Permissions-Policy keeps camera and microphone available to the interview room", () => {
    const pp = prod()["Permissions-Policy"];
    assert.match(pp, /camera=\(self\)/);
    assert.match(pp, /microphone=\(self\)/);
  });

  it("Permissions-Policy denies capabilities the product never uses", () => {
    const pp = prod()["Permissions-Policy"];
    for (const denied of ["geolocation", "payment", "usb"]) {
      assert.match(pp, new RegExp(`${denied}=\\(\\)`), `${denied} should be denied`);
    }
  });

  it("development still gets the non-transport headers", () => {
    const h = dev();
    assert.equal(h["X-Frame-Options"], "DENY");
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.ok(h["Content-Security-Policy"]);
  });

  it("never advertises the framework", () => {
    for (const h of [prod(), dev()]) {
      assert.ok(!("X-Powered-By" in h));
    }
  });
});

describe("R-1 static asset headers", () => {
  it("static responses are at least nosniff", () => {
    const names = STATIC_ASSET_SECURITY_HEADERS.map((h) => h.key);
    assert.ok(names.includes("X-Content-Type-Options"));
    const v = STATIC_ASSET_SECURITY_HEADERS.find((h) => h.key === "X-Content-Type-Options");
    assert.equal(v?.value, "nosniff");
  });

  it("does not duplicate the CSP that middleware already sets", () => {
    const names = STATIC_ASSET_SECURITY_HEADERS.map((h) => h.key);
    assert.ok(
      !names.includes("Content-Security-Policy"),
      "CSP is per-request (nonce) and belongs to middleware only",
    );
  });
});
