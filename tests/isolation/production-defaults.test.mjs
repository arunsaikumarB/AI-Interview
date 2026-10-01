/**
 * Production server with the product default: CANDIDATE_ACCOUNTS_ENABLED unset.
 *
 * Covers the staff-only block (portal, register) plus the production-only
 * gates that do not depend on that flag (dev preview, build identity).
 * Portal isolation when accounts are enabled is phase9-isolation.test.mjs,
 * which requires CANDIDATE_ACCOUNTS_ENABLED=true on the server.
 *
 * Requires: Postgres seeded, `next start` on BASE_URL (NODE_ENV=production).
 *   npm run test:isolation:defaults
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  BASE,
  api,
  cleanupIsolationPair,
  mintCookie,
  prisma,
  seedIsolationPair,
} from "./helpers.mjs";

function assertNoCandidateData(text) {
  assert.equal(text.includes("SECRET_EVAL_REASONING_BOB_ONLY"), false);
  assert.equal(text.includes("Bob SECRET"), false);
  assert.equal(/"overall"\s*:\s*91/.test(text), false);
}

describe("production defaults", () => {
  let db;
  let pair;
  let cookieA;

  before(async () => {
    const health = await fetch(`${BASE}/api/health`);
    assert.equal(health.ok, true, "App must be reachable (next start)");

    db = prisma();
    pair = await seedIsolationPair(db);
    cookieA = await mintCookie({
      id: pair.userA.id,
      email: pair.userA.email,
      name: pair.userA.name,
      role: "CANDIDATE",
      organizationId: pair.userA.organizationId,
    });
  });

  after(async () => {
    await cleanupIsolationPair(db, pair);
    await db?.$disconnect();
  });

  it("GET /dev/interview-preview is not public (404, not a login redirect)", async () => {
    const res = await fetch(`${BASE}/dev/interview-preview`, {
      redirect: "manual",
      headers: { cookie: "aros_session=not-a-jwt" },
    });
    assert.equal(res.status, 404);
  });

  it("GET /api/version exposes only the service name and a commit SHA", async () => {
    const res = await fetch(`${BASE}/api/version`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(Object.keys(json).sort(), ["commit", "service"]);
    assert.equal(json.service, "Logisoft HireOS");
    assert.match(json.commit, /^([0-9a-f]{7,40}|unknown)$/);
    if (process.env.GITHUB_SHA && /^[0-9a-f]{7,40}$/i.test(process.env.GITHUB_SHA)) {
      assert.equal(json.commit, process.env.GITHUB_SHA.toLowerCase());
    }
    const raw = JSON.stringify(json);
    for (const secret of [
      "DATABASE_URL",
      "AUTH_SECRET",
      "postgres",
      "password",
      "11434",
      "OLLAMA",
      "storage",
    ]) {
      assert.equal(raw.toLowerCase().includes(secret.toLowerCase()), false, secret);
    }
  });

  it("login placeholder is not a local seed address", async () => {
    const res = await fetch(`${BASE}/login`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(html.includes("recruiter@local.dev"), false);
    assert.equal(html.includes("name@company.com"), true);
  });

  it("candidate portal APIs return 403 and no application data", async () => {
    for (const path of [
      "/api/portal/applications",
      "/api/portal/profile",
      `/api/portal/applications?candidateId=${pair.candB.id}&applicationId=${pair.appB.id}`,
    ]) {
      const { res, text } = await api(cookieA, "GET", path);
      assert.equal(res.status, 403, `${path} → ${res.status}`);
      assert.match(text, /not available/);
      assertNoCandidateData(text);
    }
  });

  it("authenticated /portal redirects to login", async () => {
    const res = await fetch(`${BASE}/portal`, {
      redirect: "manual",
      headers: { cookie: cookieA },
    });
    assert.equal(res.status, 307);
    assert.match(res.headers.get("location") ?? "", /\/login$/);
  });

  it("POST /api/auth/register is 403 before creating a user", async () => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "new-person@example.com",
        password: "Longenough1!",
        name: "New Person",
      }),
    });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.match(json.error ?? "", /not available/);
    const created = await db.user.findUnique({
      where: { email: "new-person@example.com" },
    });
    assert.equal(created, null);
  });

  it("GET /register redirects to login", async () => {
    const res = await fetch(`${BASE}/register`, { redirect: "manual" });
    assert.equal(res.status, 307);
    assert.match(res.headers.get("location") ?? "", /\/login$/);
  });
});
