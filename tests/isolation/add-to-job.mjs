/**
 * Add an existing candidate to a job (/api/candidates/[id]/applications) and the candidate
 * page's "Add to job" control. Runs against a live server whose DATABASE_URL is a THROWAWAY
 * database (name ending in _test); creates and deletes its own data.
 *
 *   DATABASE_URL=postgresql://.../hireos_import_test BASE_URL=http://localhost:3001 \
 *     AUTH_SECRET=... node tests/isolation/add-to-job.mjs
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { BASE, COOKIE_NAME, mintCookie } from "./helpers.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("DATABASE_URL must point at a throwaway database whose name ends in _test.");
}

const db = new PrismaClient({ datasources: { db: { url } } });
const tag = `atj${Date.now()}`;
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err instanceof Error ? err.message : String(err)]);
  }
}

async function add(cookie, candidateId, body, contentType = "application/json") {
  const res = await fetch(`${BASE}/api/candidates/${encodeURIComponent(candidateId)}/applications`, {
    method: "POST",
    headers: { ...(cookie ? { Cookie: cookie } : {}), "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, json, text };
}

function assertSafeError(r) {
  assert.ok(r.json && typeof r.json.error === "string", `expected JSON error, got ${r.text.slice(0, 120)}`);
  assert.doesNotMatch(r.text, /[A-Z]:\\|\/home\/|\/opt\/|node_modules|prisma|postgres|\bat \w+ \(/i);
}

const orgA = await db.organization.create({ data: { name: `ATJ A ${tag}`, slug: `${tag}-a` } });
const orgB = await db.organization.create({ data: { name: `ATJ B ${tag}`, slug: `${tag}-b` } });
const mk = (role, org) =>
  db.user.create({
    data: { email: `${role.toLowerCase()}.${org.slug}@example.com`, name: role, role, passwordHash: "x", organizationId: org.id, isActive: true },
  });
const users = {
  hr: await mk("HR_ADMIN", orgA),
  recruiter: await mk("RECRUITER", orgA),
  manager: await mk("HIRING_MANAGER", orgA),
  interviewer: await mk("INTERVIEWER", orgA),
  candidate: await mk("CANDIDATE", orgA),
  hrB: await mk("HR_ADMIN", orgB),
};
const cookie = {};
for (const [k, u] of Object.entries(users)) cookie[k] = await mintCookie(u);
const job = (org, title, status, by) =>
  db.job.create({ data: { organizationId: org.id, title: `${title} ${tag}`, description: "d", status, createdById: by.id } });
const jobA = await job(orgA, "ATJ Java", "OPEN", users.hr);
const draftA = await job(orgA, "ATJ Draft", "DRAFT", users.hr);
const closedA = await job(orgA, "ATJ Closed", "CLOSED", users.hr);
const jobB = await job(orgB, "ATJ Secret", "OPEN", users.hrB);
const candA = await db.candidate.create({
  data: { organizationId: orgA.id, email: `asha.${tag}@example.com`, firstName: "Asha", lastName: "Rao" },
});
const candB = await db.candidate.create({
  data: { organizationId: orgB.id, email: `bina.${tag}@example.com`, firstName: "Bina", lastName: "Shah" },
});
const appCount = () => db.application.count({ where: { candidateId: { in: [candA.id, candB.id] } } });

try {
  await check("no session → 401, forged cookie → 401, nothing written", async () => {
    assert.equal((await add(null, candA.id, { jobId: jobA.id })).res.status, 401);
    const forged = await add(`${COOKIE_NAME}=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged`, candA.id, { jobId: jobA.id });
    assert.equal(forged.res.status, 401);
    assert.equal(await appCount(), 0);
  });

  for (const role of ["candidate", "interviewer"]) {
    await check(`${role} → 403 and nothing written`, async () => {
      const r = await add(cookie[role], candA.id, { jobId: jobA.id });
      assert.equal(r.res.status, 403);
      assertSafeError(r);
      assert.equal(await appCount(), 0);
    });
  }

  await check("other org: candidate → 404, job → 400; nothing written", async () => {
    const r1 = await add(cookie.hrB, candA.id, { jobId: jobB.id });
    assert.equal(r1.res.status, 404);
    assertSafeError(r1);
    const r2 = await add(cookie.hr, candA.id, { jobId: jobB.id });
    assert.equal(r2.res.status, 400);
    assertSafeError(r2);
    const r3 = await add(cookie.hr, candB.id, { jobId: jobA.id });
    assert.equal(r3.res.status, 404);
    assert.equal(await appCount(), 0);
  });

  await check("bad input: closed job, unknown ids, long ids, extra fields, non-JSON → safe 4xx", async () => {
    for (const [cand, body, status, type] of [
      [candA.id, { jobId: closedA.id }, 400],
      [candA.id, { jobId: "nope" }, 400],
      ["nope", { jobId: jobA.id }, 404],
      ["x".repeat(65), { jobId: jobA.id }, 404],
      [candA.id, { jobId: "x".repeat(65) }, 400],
      [candA.id, { jobId: jobA.id, stage: "SELECTED" }, 400],
      [candA.id, { jobId: 5 }, 400],
      [candA.id, "{not json", 400],
      [candA.id, JSON.stringify({ jobId: jobA.id }), 415, "text/plain"],
    ]) {
      const r = await add(cookie.hr, cand, body, type);
      assert.equal(r.res.status, status, `${JSON.stringify(body).slice(0, 60)} → ${r.res.status}`);
      assertSafeError(r);
    }
    assert.equal(await appCount(), 0);
  });

  await check("recruiter adds to an open job: one Applied/Active application + timeline event; no-store", async () => {
    const r = await add(cookie.recruiter, candA.id, { jobId: jobA.id });
    assert.equal(r.res.status, 201);
    assert.equal(r.res.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(r.json), ["applicationId"]);
    const app = await db.application.findUniqueOrThrow({ where: { id: r.json.applicationId }, include: { timelineEvents: true } });
    assert.equal(app.candidateId, candA.id);
    assert.equal(app.jobId, jobA.id);
    assert.equal(app.stage, "APPLIED");
    assert.equal(app.status, "ACTIVE");
    assert.equal(app.source, "added_by_staff");
    assert.deepEqual(app.timelineEvents.map((t) => t.type), ["APPLICATION_CREATED"]);
    const cand = await db.candidate.findUniqueOrThrow({ where: { id: candA.id } });
    assert.equal(`${cand.firstName} ${cand.lastName}`, "Asha Rao", "profile is not changed");
  });

  await check("same job again → 409, still one application; hiring manager can add to a draft job", async () => {
    const again = await add(cookie.hr, candA.id, { jobId: jobA.id });
    assert.equal(again.res.status, 409);
    assertSafeError(again);
    const mgr = await add(cookie.manager, candA.id, { jobId: draftA.id });
    assert.equal(mgr.res.status, 201);
    assert.equal(await db.application.count({ where: { candidateId: candA.id } }), 2);
  });

  await check("candidate page: no-job candidate shows Add to job with own-org non-closed jobs only", async () => {
    const fresh = await db.candidate.create({
      data: { organizationId: orgA.id, email: `ravi.${tag}@example.com`, firstName: "Ravi", lastName: "K" },
    });
    const page = await fetch(`${BASE}/dashboard/candidates/${fresh.id}`, { headers: { Cookie: cookie.hr } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Not in a job yet/);
    assert.match(html, new RegExp(`ATJ Java ${tag}`));
    assert.match(html, new RegExp(`ATJ Draft ${tag}`));
    assert.doesNotMatch(html, new RegExp(`ATJ Closed ${tag}|ATJ Secret ${tag}`));
    const asInterviewer = await fetch(`${BASE}/dashboard/candidates/${fresh.id}`, { headers: { Cookie: cookie.interviewer } });
    const ihtml = await asInterviewer.text();
    assert.doesNotMatch(ihtml, /Not in a job yet|Add to job/);
    const otherOrg = await fetch(`${BASE}/dashboard/candidates/${fresh.id}`, { headers: { Cookie: cookie.hrB } });
    assert.equal(otherOrg.status, 404);
  });
} finally {
  await db.application.deleteMany({ where: { job: { organizationId: { in: [orgA.id, orgB.id] } } } });
  await db.job.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await db.candidate.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await db.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await db.$disconnect();
}

for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
