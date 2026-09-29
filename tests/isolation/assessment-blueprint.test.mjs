/**
 * Assessment Engine V1 — API isolation for GET /api/jobs/[id]/assessment-blueprint.
 *
 * Covers: unauthenticated, wrong role (CANDIDATE, INTERVIEWER), authorized
 * RECRUITER, wrong organisation, invalid ids, malformed query, cross-job
 * application id, no write path, and read-only behaviour (stage / timeline /
 * AI evaluations unchanged).
 *
 * Requires: Postgres seeded, Next.js on BASE_URL (default :3000), AUTH_SECRET set.
 * Temporary users / organisation are created and removed by this file.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  BASE,
  api,
  cleanupIsolationPair,
  mintCookie,
  prisma,
  seedIsolationPair,
} from "./helpers.mjs";

describe("Assessment blueprint API isolation", () => {
  /** @type {import('@prisma/client').PrismaClient} */
  let db;
  let pair;
  let otherOrg;
  const tempUsers = [];
  let recruiterCookie;
  let interviewerCookie;
  let candidateCookie;
  let otherOrgRecruiterCookie;
  let path;

  async function tempUser(role, organizationId, tag) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const u = await db.user.create({
      data: {
        email: `iso-assess-${tag}-${stamp}@example.com`,
        name: `Isolation ${tag}`,
        role,
        passwordHash: await bcrypt.hash(`iso-${stamp}`, 10),
        organizationId,
        isActive: true,
      },
    });
    tempUsers.push(u.id);
    return mintCookie({ id: u.id, email: u.email, name: u.name, role, organizationId });
  }

  before(async () => {
    const health = await fetch(`${BASE}/api/health`);
    assert.equal(health.ok, true, "App must be reachable (npm run dev / start)");

    db = prisma();
    pair = await seedIsolationPair(db);
    otherOrg = await db.organization.create({
      data: { name: "Isolation Other Org", slug: `iso-assess-org-${Date.now()}` },
    });

    recruiterCookie = await tempUser("RECRUITER", pair.org.id, "recruiter");
    interviewerCookie = await tempUser("INTERVIEWER", pair.org.id, "interviewer");
    otherOrgRecruiterCookie = await tempUser("RECRUITER", otherOrg.id, "other-org");
    candidateCookie = await mintCookie({
      id: pair.userA.id,
      email: pair.userA.email,
      name: pair.userA.name,
      role: "CANDIDATE",
      organizationId: pair.userA.organizationId,
    });
    path = `/api/jobs/${pair.job.id}/assessment-blueprint`;
  });

  after(async () => {
    if (db) {
      await db.user.deleteMany({ where: { id: { in: tempUsers } } });
      if (otherOrg) await db.organization.deleteMany({ where: { id: otherOrg.id } });
      await cleanupIsolationPair(db, pair);
      await db.$disconnect();
    }
  });

  it("unauthenticated → 401", async () => {
    const res = await fetch(`${BASE}${path}`);
    assert.equal(res.status, 401);
  });

  it("CANDIDATE → 403 and no blueprint content", async () => {
    const { res, text } = await api(candidateCookie, "GET", path);
    assert.equal(res.status, 403);
    assert.ok(!text.includes("competencies"));
  });

  it("INTERVIEWER → 403", async () => {
    const { res } = await api(interviewerCookie, "GET", path);
    assert.equal(res.status, 403);
  });

  it("RECRUITER (same org) → 200 advisory blueprint", async () => {
    const { res, json } = await api(recruiterCookie, "GET", path);
    assert.equal(res.status, 200);
    assert.equal(json.engineVersion, "assessment-engine-v1");
    assert.equal(json.job.id, pair.job.id);
    assert.equal(json.candidate, null);
    assert.ok(Array.isArray(json.questions) && json.questions.length > 0);
    assert.equal(json.guardrails.advisoryOnly, true);
    assert.equal(json.guardrails.noStageChange, true);
    assert.equal(json.practical.executionSupported, false);
  });

  it("RECRUITER with own-org applicationId → resume-grounded, no contact fields", async () => {
    const { res, json, text } = await api(recruiterCookie, "GET", `${path}?applicationId=${pair.appA.id}`);
    assert.equal(res.status, 200);
    assert.equal(json.candidate.applicationId, pair.appA.id);
    assert.ok(!text.includes(pair.userA.email), "candidate email is never returned");
    assert.ok(!/"email"\s*:/.test(text));
    assert.ok(!/"phone"\s*:/.test(text));
  });

  it("wrong organisation → 404 (no existence leak)", async () => {
    const { res, text } = await api(otherOrgRecruiterCookie, "GET", path);
    assert.equal(res.status, 404);
    assert.ok(!text.includes(pair.job.title));
    const withApp = await api(otherOrgRecruiterCookie, "GET", `${path}?applicationId=${pair.appA.id}`);
    assert.equal(withApp.res.status, 404);
  });

  it("applicationId from a different job → 404", async (t) => {
    if (pair.jobB.id === pair.job.id) {
      t.skip("only one OPEN job in the seed; cross-job case not constructible");
      return;
    }
    const { res, text } = await api(recruiterCookie, "GET", `${path}?applicationId=${pair.appB.id}`);
    assert.equal(res.status, 404);
    assert.ok(!text.includes("Bob SECRET"));
  });

  it("invalid / unknown job id", async () => {
    const bad = await api(recruiterCookie, "GET", `/api/jobs/${encodeURIComponent("bad$id<x>")}/assessment-blueprint`);
    assert.equal(bad.res.status, 400);
    const missing = await api(recruiterCookie, "GET", "/api/jobs/nonexistentbutwellformed01/assessment-blueprint");
    assert.equal(missing.res.status, 404);
  });

  it("malformed query → 400", async () => {
    for (const q of [
      "applicationId=../../etc/passwd",
      "view=evil",
      "unexpected=1",
      "view=resume-questions",
    ]) {
      const { res, text } = await api(recruiterCookie, "GET", `${path}?${q}`);
      assert.equal(res.status, 400, q);
      assert.ok(!/at .*\(|prisma|DATABASE_URL/i.test(text), "no internals in error");
    }
  });

  it("partial views return only their section", async () => {
    const { res, json } = await api(recruiterCookie, "GET", `${path}?view=classification`);
    assert.equal(res.status, 200);
    assert.ok(json.classification);
    assert.equal(json.questions, undefined);
    assert.equal(json.competencies, undefined);
  });

  it("no write path: POST / PATCH / DELETE are not allowed", async () => {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const { res } = await api(recruiterCookie, method, path, {});
      assert.ok([405, 403].includes(res.status), `${method} → ${res.status}`);
    }
  });

  it("dashboard page: CANDIDATE and INTERVIEWER cannot view the blueprint; RECRUITER can", async () => {
    const page = `/dashboard/jobs/${pair.job.id}/assessment`;
    const get = (cookie) => fetch(`${BASE}${page}`, { headers: { Cookie: cookie }, redirect: "manual" });

    const cand = await get(candidateCookie);
    const candText = await cand.text();
    assert.ok(cand.status !== 200 || !candText.includes("Competency matrix"), `candidate got ${cand.status}`);

    const interviewer = await get(interviewerCookie);
    const intText = await interviewer.text();
    assert.ok(!intText.includes("Competency matrix"), `interviewer got ${interviewer.status}`);

    const other = await get(otherOrgRecruiterCookie);
    const otherText = await other.text();
    assert.ok(!otherText.includes("Competency matrix"), `other org got ${other.status}`);

    const ok = await get(recruiterCookie);
    assert.equal(ok.status, 200);
    assert.ok((await ok.text()).includes("Competency matrix"));
  });

  it("read-only: stage, status, timeline and AI evaluations unchanged", async () => {
    const before = await db.application.findUnique({
      where: { id: pair.appA.id },
      select: { stage: true, status: true, _count: { select: { timelineEvents: true, aiEvaluations: true } } },
    });
    for (let i = 0; i < 3; i++) {
      const { res } = await api(recruiterCookie, "GET", `${path}?applicationId=${pair.appA.id}`);
      assert.equal(res.status, 200);
    }
    const after = await db.application.findUnique({
      where: { id: pair.appA.id },
      select: { stage: true, status: true, _count: { select: { timelineEvents: true, aiEvaluations: true } } },
    });
    assert.deepEqual(after, before);
  });
});
