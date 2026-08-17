/**
 * F-02 regression — a deactivated account must lose access immediately.
 *
 * A signed aros_session JWT stays cryptographically valid for its full TTL
 * (default 12h). Before this fix, deactivating a user in the admin console did
 * not stop their existing session: every staff API kept returning 200 because
 * the guards trusted the token claims and never re-read the account row.
 *
 * This suite pins the whole lifecycle so the regression cannot come back:
 *   active -> 200, deactivated (same cookie) -> 401, reactivated -> 200.
 *
 * Requires: Postgres seeded, Next.js on BASE_URL (default :3000), AUTH_SECRET set.
 *   npm run test:isolation
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { api, mintCookie, prisma } from "./helpers.mjs";

/** Staff surfaces that must all honour account status, not just one of them. */
const STAFF_ENDPOINTS = [
  { method: "GET", path: "/api/jobs" },
  { method: "GET", path: "/api/candidates" },
  { method: "GET", path: "/api/applications" },
  { method: "GET", path: "/api/analytics" },
  { method: "GET", path: "/api/auth/me" },
];

describe("F-02 deactivated session revocation", () => {
  /** @type {import('@prisma/client').PrismaClient} */
  let db;
  let user;
  let cookie;

  before(async () => {
    const health = await fetch(
      `${process.env.BASE_URL ?? "http://localhost:3000"}/api/health`,
    );
    assert.equal(health.ok, true, "App must be reachable (npm run dev / start)");

    db = prisma();
    const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
    assert.ok(org, "No organization — run db:seed first");

    user = await db.user.create({
      data: {
        email: `deactivation-probe-${Date.now()}@example.com`,
        name: "Deactivation Probe",
        role: "RECRUITER",
        passwordHash: await bcrypt.hash("deactivation-test-password-ok", 10),
        organizationId: org.id,
        isActive: true,
      },
    });

    // One cookie, minted while active, reused for every phase below. This is
    // exactly the attacker's position: a session obtained before deactivation.
    cookie = await mintCookie({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
    });
  });

  after(async () => {
    if (db && user) {
      await db.user.deleteMany({ where: { id: user.id } });
      await db.$disconnect();
    }
  });

  it("active staff user reaches staff APIs (fix must not break normal access)", async () => {
    for (const ep of STAFF_ENDPOINTS) {
      const { res } = await api(cookie, ep.method, ep.path);
      assert.equal(
        res.status,
        200,
        `${ep.method} ${ep.path} should be 200 while the account is active, got ${res.status}`,
      );
    }
  });

  it("deactivated user is rejected on every staff API with the same cookie", async () => {
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });

    for (const ep of STAFF_ENDPOINTS) {
      const { res } = await api(cookie, ep.method, ep.path);
      assert.equal(
        res.status,
        401,
        `${ep.method} ${ep.path} must be 401 after deactivation, got ${res.status}`,
      );
    }
  });

  it("deactivated user leaks no data in the rejection body", async () => {
    const { res, text } = await api(cookie, "GET", "/api/candidates");
    assert.equal(res.status, 401);
    assert.ok(
      !/resumeText|passwordHash|embedding/i.test(text),
      "401 body must not carry candidate or credential data",
    );
  });

  it("reactivating restores access with the same cookie (not a permanent lockout)", async () => {
    await db.user.update({ where: { id: user.id }, data: { isActive: true } });

    const { res } = await api(cookie, "GET", "/api/jobs");
    assert.equal(res.status, 200, "Reactivated user should regain access");
  });

  it("a deleted account cannot use a previously valid token", async () => {
    const ghost = await db.user.create({
      data: {
        email: `ghost-probe-${Date.now()}@example.com`,
        name: "Ghost Probe",
        role: "RECRUITER",
        passwordHash: await bcrypt.hash("ghost-test-password-ok", 10),
        organizationId: user.organizationId,
        isActive: true,
      },
    });
    const ghostCookie = await mintCookie({
      id: ghost.id,
      email: ghost.email,
      name: ghost.name,
      role: ghost.role,
      organizationId: ghost.organizationId,
    });

    const before = await api(ghostCookie, "GET", "/api/jobs");
    assert.equal(before.res.status, 200);

    await db.user.delete({ where: { id: ghost.id } });

    const after = await api(ghostCookie, "GET", "/api/jobs");
    assert.equal(after.res.status, 401, "Token for a deleted account must be rejected");
  });
});
