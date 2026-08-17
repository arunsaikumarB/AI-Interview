/**
 * Live HTTP verification of the production-hardening pass.
 *
 *   R-1  security headers, and the CSP not blocking anything real
 *   R-2  the public health payload discloses no infrastructure
 *   R-10 the session cookie is Secure over HTTPS, usable over HTTP localhost
 *
 * Run against a server:
 *   npm run build && npx next start -p 3000
 *   BASE_URL=http://localhost:3000 npx tsx --test tests/isolation/production-hardening.test.mjs
 *
 * The header and health checks need only a reachable server. The login/cookie
 * checks additionally need Postgres, and skip themselves (loudly) without it.
 */
import "./load-env.mjs";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

/** Parse a CSP header into directive -> sources. */
function parseCsp(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length) out[tokens[0]] = tokens.slice(1);
  }
  return out;
}

/**
 * Resolved at module load, NOT in a before() hook: node:test evaluates the
 * `skip` option while collecting tests, which happens before any hook runs.
 * A hook-assigned flag is always still false at that point, so every
 * database-backed test would silently skip even with Postgres up.
 */
const health = await fetch(`${BASE}/api/health`).catch(() => null);
assert.ok(health, `App must be reachable at ${BASE}`);
const dbUp = (await health.json().catch(() => ({})))?.database?.ok === true;
if (!dbUp) {
  console.warn("[hardening] Postgres is down — cookie/login assertions will be skipped");
}

describe("R-1 security headers on a page response", () => {
  let headers;

  before(async () => {
    const res = await fetch(`${BASE}/login`, { redirect: "manual" });
    assert.equal(res.status, 200);
    headers = res.headers;
  });

  it("sends a Content-Security-Policy", () => {
    assert.ok(headers.get("content-security-policy"), "no CSP header");
  });

  it("denies framing two ways", () => {
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.deepEqual(parseCsp(headers.get("content-security-policy"))["frame-ancestors"], [
      "'none'",
    ]);
  });

  it("sets nosniff and a referrer policy", () => {
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  it("keeps camera and microphone available to the interview room", () => {
    const pp = headers.get("permissions-policy") ?? "";
    assert.match(pp, /camera=\(self\)/);
    assert.match(pp, /microphone=\(self\)/);
  });

  it("does not advertise the framework", () => {
    assert.equal(headers.get("x-powered-by"), null);
  });

  it("carries a per-request nonce that changes between requests", async () => {
    const a = parseCsp(headers.get("content-security-policy"))["script-src"].find((s) =>
      s.startsWith("'nonce-"),
    );
    const second = await fetch(`${BASE}/login`, { redirect: "manual" });
    const b = parseCsp(second.headers.get("content-security-policy"))["script-src"].find((s) =>
      s.startsWith("'nonce-"),
    );
    assert.ok(a && b, "script-src must carry a nonce");
    assert.notEqual(a, b, "the nonce must be per-request, not per-build");
  });

  it("allows WebAssembly so MediaPipe still loads", () => {
    const csp = parseCsp(headers.get("content-security-policy"));
    assert.ok(csp["script-src"].includes("'wasm-unsafe-eval'"));
  });

  it("allows data: images (pairing QR) and blob: media (recordings)", () => {
    const csp = parseCsp(headers.get("content-security-policy"));
    assert.ok(csp["img-src"].includes("data:"));
    assert.ok(csp["media-src"].includes("blob:"));
  });
});

describe("R-1 the CSP does not block the app's own scripts", () => {
  /**
   * The failure mode this guards against: a statically pre-rendered page is
   * baked at build time without a nonce, so a nonce-based CSP blocks every
   * inline script on it — including hydration. That is exactly what happened
   * to /login and /register before they were made dynamic.
   */
  for (const path of ["/login", "/register"]) {
    it(`${path} has no inline script without a nonce`, async () => {
      const html = await fetch(`${BASE}${path}`).then((r) => r.text());
      const bare = html.match(/<script>/g)?.length ?? 0;
      const nonced = html.match(/<script nonce="[^"]{4,}"/g)?.length ?? 0;
      assert.equal(
        bare,
        0,
        `${path} has ${bare} un-nonced inline script(s) — the production CSP would block them`,
      );
      assert.ok(nonced > 0, `${path} should have nonce'd inline scripts`);
    });
  }

  it("headers are present on API responses too", async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("content-security-policy"));
  });

  it("headers are present on a 401 from a protected API", async () => {
    const res = await fetch(`${BASE}/api/jobs`, { redirect: "manual" });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  });

  it("static assets are at least nosniff", async () => {
    const res = await fetch(`${BASE}/mediapipe/models/efficientdet_lite2.tflite`, {
      method: "HEAD",
    });
    if (res.status === 200) {
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    }
  });
});

describe("R-1 HSTS follows the transport", () => {
  it("is absent over plain HTTP", async () => {
    if (BASE.startsWith("https://")) return;
    const res = await fetch(`${BASE}/login`, { redirect: "manual" });
    assert.equal(
      res.headers.get("strict-transport-security"),
      null,
      "HSTS over plain HTTP would be meaningless and is not sent",
    );
  });

  it("is present when the request is forwarded as HTTPS", async () => {
    const res = await fetch(`${BASE}/login`, {
      redirect: "manual",
      headers: { "x-forwarded-proto": "https" },
    });
    const hsts = res.headers.get("strict-transport-security");
    assert.ok(hsts, "the LAN pilot proxy forwards https and must get HSTS");
    assert.match(hsts, /max-age=\d{7,}/);
    assert.match(hsts, /includeSubDomains/);
  });
});

describe("R-2 public health discloses no infrastructure", () => {
  let body;
  let raw;

  before(async () => {
    const res = await fetch(`${BASE}/api/health`);
    raw = await res.text();
    body = JSON.parse(raw);
  });

  it("exposes only reachability booleans", () => {
    assert.deepEqual(Object.keys(body).sort(), [
      "database",
      "ok",
      "ollama",
      "service",
      "speech",
    ]);
  });

  for (const secret of [
    "11434",
    "8001",
    "qwen",
    "nomic",
    "localhost",
    "127.0.0.1",
    "storage",
    "whisper",
    "lessac",
    "clipboard",
  ]) {
    it(`does not leak "${secret}"`, () => {
      assert.ok(!raw.toLowerCase().includes(secret.toLowerCase()), raw);
    });
  }

  it("keeps the shape the pilot script and the offline banner depend on", () => {
    assert.equal(typeof body.ok, "boolean");
    assert.equal(typeof body.database.ok, "boolean");
    assert.ok(raw.includes('"database":{"ok":'), raw);
  });

  it("carries no error strings even when a dependency is down", () => {
    for (const key of ["database", "ollama", "speech"]) {
      assert.ok(!("error" in body[key]), `${key} must not carry error text`);
    }
  });
});

describe("R-10 session cookie", () => {
  let user;
  const password = "hardening-cookie-probe-Pw1";

  before(async () => {
    if (!dbUp) return;
    const db = prisma();
    const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
    user = await db.user.create({
      data: {
        email: `hardening-cookie-${Date.now()}@example.com`,
        name: "Cookie Probe",
        role: "RECRUITER",
        passwordHash: await bcrypt.hash(password, 10),
        organizationId: org.id,
        isActive: true,
      },
    });
    await db.$disconnect();
  });

  after(async () => {
    if (!user) return;
    const db = prisma();
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
    await db.$disconnect();
  });

  async function login(extraHeaders = {}) {
    return fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify({ email: user.email, password }),
    });
  }

  it("login still works", { skip: !dbUp && "Postgres unavailable" }, async () => {
    const res = await login();
    assert.equal(res.status, 200);
  });

  it("cookie is HttpOnly, SameSite=Lax, path /", { skip: !dbUp && "Postgres unavailable" }, async () => {
    const sc = (await login()).headers.get("set-cookie") ?? "";
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Lax/i);
    assert.match(sc, /Path=\//i);
  });

  it(
    "REGRESSION: forwarded HTTPS gets Secure even on a dev build",
    { skip: !dbUp && "Postgres unavailable" },
    async () => {
      const sc =
        (await login({ "x-forwarded-proto": "https" })).headers.get("set-cookie") ?? "";
      assert.match(sc, /Secure/i, "the :3443 LAN pilot must not issue a non-Secure cookie");
    },
  );

  it(
    "login over plain HTTP still succeeds and issues a cookie",
    { skip: !dbUp && "Postgres unavailable" },
    async () => {
      const res = await login();
      assert.equal(res.status, 200);
      assert.match(res.headers.get("set-cookie") ?? "", /aros_session=/);
    },
  );

  /**
   * The Secure-vs-transport matrix depends on the mode the *server* runs in,
   * which the test runner cannot read from its own process.env. Pass
   * UAT_SERVER_MODE=production|development to assert it; without it, only the
   * mode-independent rules above are checked. The full matrix is also pinned
   * by tests/unit/session-cookie.test.ts.
   */
  const serverMode = process.env.UAT_SERVER_MODE;

  it(
    "production: plain HTTP still gets Secure (fail-safe, never send a session in the clear)",
    { skip: (!dbUp && "Postgres unavailable") || (serverMode !== "production" && "needs UAT_SERVER_MODE=production") },
    async () => {
      const sc = (await login()).headers.get("set-cookie") ?? "";
      assert.match(sc, /Secure/i);
    },
  );

  it(
    "development: plain HTTP localhost gets no Secure, so dev login works",
    { skip: (!dbUp && "Postgres unavailable") || (serverMode !== "development" && "needs UAT_SERVER_MODE=development") },
    async () => {
      const sc = (await login()).headers.get("set-cookie") ?? "";
      assert.ok(!/Secure/i.test(sc), "a Secure cookie over http:// would be dropped by the browser");
    },
  );

  it("logout clears the cookie", { skip: !dbUp && "Postgres unavailable" }, async () => {
    const sc = (await login()).headers.get("set-cookie") ?? "";
    const cookie = sc.split(";")[0];
    const out = await fetch(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const cleared = out.headers.get("set-cookie") ?? "";
    assert.match(cleared, /aros_session=/);
    assert.ok(
      /Max-Age=0/i.test(cleared) || /Expires=Thu, 01 Jan 1970/i.test(cleared),
      `cookie not expired: ${cleared}`,
    );
  });

  it("/api/auth/me works with the issued cookie", { skip: !dbUp && "Postgres unavailable" }, async () => {
    const sc = (await login()).headers.get("set-cookie") ?? "";
    const me = await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: sc.split(";")[0] },
    });
    assert.equal(me.status, 200);
    const body = await me.text();
    assert.ok(!/passwordHash/i.test(body));
  });

  it("invalid credentials are still rejected", { skip: !dbUp && "Postgres unavailable" }, async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "wrong-password-entirely" }),
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("set-cookie"), null, "a failed login must not set a cookie");
  });
});
