/**
 * Talent Pool search (/api/talent/browse), Add to Hiring, the Candidates page and Careers,
 * over HTTP. Runs against a live server whose DATABASE_URL is a THROWAWAY database (name
 * ending in _test); creates and deletes its own data.
 *
 *   DATABASE_URL=postgresql://.../hireos_import_test BASE_URL=http://localhost:3002 \
 *     AUTH_SECRET=... node tests/isolation/talent-pool.mjs
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { BASE, COOKIE_NAME, mintCookie } from "./helpers.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("DATABASE_URL must point at a throwaway database whose name ends in _test.");
}

const db = new PrismaClient({ datasources: { db: { url } } });
const tag = `tpi${Date.now()}`;
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err instanceof Error ? err.message : String(err)]);
  }
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, json, text };
}

async function addToHiring(cookie, candidateId, jobId) {
  const res = await fetch(`${BASE}/api/candidates/${encodeURIComponent(candidateId)}/applications`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  return { res, json: await res.json().catch(() => null) };
}

function assertSafeError(r) {
  assert.ok(r.json && typeof r.json.error === "string", `expected JSON error, got ${r.text.slice(0, 120)}`);
  assert.doesNotMatch(r.text, /[A-Z]:\\|\/home\/|\/opt\/|node_modules|prisma|postgres|\bat \w+ \(/i);
}

const orgA = await db.organization.create({ data: { name: `TPI A ${tag}`, slug: `${tag}-a` } });
const orgB = await db.organization.create({ data: { name: `TPI B ${tag}`, slug: `${tag}-b` } });
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
  db.job.create({ data: { organizationId: org.id, title: `${title} ${tag}`, description: "d", location: "Hyderabad", status, createdById: by.id } });
const openA = await job(orgA, "TPI DotNet", "OPEN", users.hr);
const pausedA = await job(orgA, "TPI Paused", "PAUSED", users.hr);
const closedA = await job(orgA, "TPI DotNet 2023", "CLOSED", users.hr);
const openB = await job(orgB, "TPI Secret", "OPEN", users.hrB);

const historical = await db.candidate.create({
  data: {
    organizationId: orgA.id,
    email: `seetharam.${tag}@example.com`,
    firstName: "Seetharam",
    lastName: `Hist${tag}`,
    phone: "9000000001",
    experience: 4.6,
    resumeText: "SECRET-RESUME-TEXT",
    applications: {
      create: {
        jobId: closedA.id,
        stage: "APPLIED",
        status: "ON_HOLD",
        source: "resume_parser",
        createdAt: new Date(Date.UTC(2023, 4, 10, 12)),
        timelineEvents: { create: { type: "APPLICATION_CREATED", payload: { source: "resume_parser", resumeParserId: `RP-${tag}` } } },
      },
    },
  },
});
await db.candidate.create({
  data: { organizationId: orgA.id, email: `uma.${tag}@example.com`, firstName: "Uma", lastName: `Upload${tag}`, experience: 3 },
});
await db.candidate.create({
  data: {
    organizationId: orgA.id,
    email: `kavya.${tag}@example.com`,
    firstName: "Kavya",
    lastName: `Active${tag}`,
    applications: { create: { jobId: openA.id, stage: "SCREENING", status: "ACTIVE", source: "careers_site" } },
  },
});
const secretB = await db.candidate.create({
  data: { organizationId: orgB.id, email: `bina.${tag}@example.com`, firstName: "Bina", lastName: `Secret${tag}` },
});
const orgIds = [orgA.id, orgB.id];

try {
  await check("talent browse: no session / forged cookie → 401", async () => {
    assert.equal((await get(`/api/talent/browse`)).res.status, 401);
    const forged = await get(`/api/talent/browse`, `${COOKIE_NAME}=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged`);
    assert.equal(forged.res.status, 401);
  });

  for (const role of ["candidate", "interviewer"]) {
    await check(`talent browse: ${role} → 403`, async () => {
      const r = await get(`/api/talent/browse`, cookie[role]);
      assert.equal(r.res.status, 403);
      assertSafeError(r);
    });
  }

  await check("talent browse: HR sees own organization only, one page, no phone/resume text; no-store", async () => {
    const r = await get(`/api/talent/browse?q=${tag}`, cookie.hr);
    assert.equal(r.res.status, 200);
    assert.equal(r.res.headers.get("cache-control"), "no-store");
    assert.equal(r.json.pageSize, 25);
    assert.equal(r.json.total, 3);
    const names = r.json.rows.map((x) => x.name).sort();
    assert.deepEqual(names, [`Kavya Active${tag}`, `Seetharam Hist${tag}`, `Uma Upload${tag}`]);
    assert.doesNotMatch(r.text, /SECRET-RESUME-TEXT|9000000001|Bina|passwordHash|embedding/);
    const b = await get(`/api/talent/browse?q=${tag}`, cookie.hrB);
    assert.deepEqual(b.json.rows.map((x) => x.name), [`Bina Secret${tag}`]);
  });

  await check("talent browse: Seetharam example (role + experience + year)", async () => {
    const r = await get(`/api/talent/browse?role=TPI+DotNet&minExp=4&year=2023&hiring=not_in_hiring`, cookie.manager);
    assert.equal(r.res.status, 200);
    assert.deepEqual(r.json.rows.map((x) => x.id), [historical.id]);
    assert.equal(r.json.rows[0].inHiring, null);
  });

  await check("talent browse: malformed filters → safe 400", async () => {
    for (const qs of ["month=3", "source=linkedin", `organizationId=${orgB.id}`, "minExp=abc", "page=0", `q=${"x".repeat(101)}`, "minExp=9&maxExp=1"]) {
      const r = await get(`/api/talent/browse?${qs}`, cookie.hr);
      assert.equal(r.res.status, 400, qs);
      assertSafeError(r);
    }
  });

  await check("Candidates page lists people in hiring only; talent-only profiles are not there", async () => {
    const html = (await get(`/dashboard/candidates?q=${tag}`, cookie.hr)).text;
    assert.match(html, new RegExp(`Kavya Active${tag}`));
    assert.doesNotMatch(html, new RegExp(`Seetharam Hist${tag}|Uma Upload${tag}`));
  });

  await check("Talent Pool page: HR and hiring manager see search, no CSV import anywhere; interviewer redirected", async () => {
    const hr = await get(`/dashboard/talent`, cookie.hr);
    assert.equal(hr.res.status, 200);
    assert.match(hr.text, /Search historical and available candidates/);
    assert.doesNotMatch(hr.text, /Import Resume Parser|Resume Parser export|Upload CSV|Import CSV|\.csv/i);
    assert.match(hr.text, new RegExp(`TPI DotNet ${tag}`));
    assert.doesNotMatch(hr.text, new RegExp(`TPI Paused ${tag}|TPI DotNet 2023 ${tag}|TPI Secret ${tag}`), "only open openings of own org");
    const mgr = await get(`/dashboard/talent`, cookie.manager);
    assert.equal(mgr.res.status, 200);
    assert.match(mgr.text, /Search historical and available candidates/);
    const iv = await get(`/dashboard/talent`, cookie.interviewer);
    assert.ok([307, 308].includes(iv.res.status) || /NEXT_REDIRECT/.test(iv.text), `interviewer got ${iv.res.status}`);
  });

  await check("Resume Parser CSV import page and APIs are gone (404)", async () => {
    assert.equal((await get(`/dashboard/talent/import`, cookie.hr)).res.status, 404);
    for (const path of ["/api/candidates/import/resume-parser", "/api/candidates/import/resume-parser/resumes"]) {
      const fd = new FormData();
      fd.set("mode", "columns");
      fd.set("file", new Blob(["Email,Applied Role\na@example.com,QA\n"], { type: "text/csv" }), "export.csv");
      const res = await fetch(`${BASE}${path}`, { method: "POST", body: fd, headers: { Cookie: cookie.hr, Origin: BASE } });
      assert.equal(res.status, 404, `${path} got ${res.status}`);
    }
  });

  await check("candidate page: historical person shows Talent Pool state + history, no screening/interview controls", async () => {
    const html = (await get(`/dashboard/candidates/${historical.id}`, cookie.hr)).text;
    assert.match(html, /In Talent Pool · not in hiring yet/);
    assert.match(html, /Application history/);
    assert.match(html, new RegExp(`TPI DotNet 2023 ${tag}`));
    assert.doesNotMatch(html, /Create Interview|Move Stage/);
  });

  await check("Add to Hiring: paused / closed / other-org opening → 400; other-org candidate → 404; nothing written", async () => {
    for (const jobId of [pausedA.id, closedA.id, openB.id]) {
      const r = await addToHiring(cookie.hr, historical.id, jobId);
      assert.equal(r.res.status, 400, jobId);
    }
    assert.equal((await addToHiring(cookie.hr, secretB.id, openA.id)).res.status, 404);
    assert.equal((await addToHiring(cookie.interviewer, historical.id, openA.id)).res.status, 403);
    assert.equal(await db.application.count({ where: { candidateId: { in: [historical.id, secretB.id] } } }), 1);
  });

  await check("Add to Hiring: historical person enters the open opening and appears in Candidates; no AI, no interview", async () => {
    const r = await addToHiring(cookie.recruiter, historical.id, openA.id);
    assert.equal(r.res.status, 201);
    const app = await db.application.findUniqueOrThrow({ where: { id: r.json.applicationId } });
    assert.equal(app.jobId, openA.id);
    assert.equal(app.status, "ACTIVE");
    assert.equal(app.stage, "APPLIED");
    const hist = await db.application.findFirstOrThrow({ where: { candidateId: historical.id, jobId: closedA.id } });
    assert.equal(hist.status, "ON_HOLD", "history untouched");
    assert.equal(hist.createdAt.toISOString(), "2023-05-10T12:00:00.000Z");
    const again = await addToHiring(cookie.hr, historical.id, openA.id);
    assert.equal(again.res.status, 409);
    const html = (await get(`/dashboard/candidates?q=${tag}`, cookie.hr)).text;
    assert.match(html, new RegExp(`Seetharam Hist${tag}`));
    assert.doesNotMatch(html, new RegExp(`Uma Upload${tag}`));
    const detail = (await get(`/dashboard/candidates/${historical.id}`, cookie.hr)).text;
    assert.match(detail, /Create Interview/);
    assert.match(detail, /Application history/);
    const where = { application: { candidateId: historical.id } };
    assert.equal(await db.aIEvaluation.count({ where }), 0);
    assert.equal(await db.interviewSession.count({ where }), 0);
    assert.equal(await db.practicalAssessment.count({ where }), 0);
  });

  await check("Careers: open opening listed, paused/closed not; applying creates Candidate + Application in hiring", async () => {
    const list = await get(`/api/careers`);
    assert.equal(list.res.status, 200);
    const titles = list.json.jobs.map((j) => j.title);
    assert.ok(titles.includes(`TPI DotNet ${tag}`));
    assert.ok(!titles.some((t) => t === `TPI Paused ${tag}` || t === `TPI DotNet 2023 ${tag}`));
    const closedPage = await fetch(`${BASE}/api/careers/${closedA.id}`);
    assert.equal(closedPage.status, 404);

    const form = new FormData();
    form.set("jobId", openA.id);
    form.set("firstName", "Careers");
    form.set("lastName", `Applicant${tag}`);
    form.set("email", `careers.${tag}@example.com`);
    const pdf = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n";
    form.set("resume", new File([pdf], "cv.pdf", { type: "application/pdf" }));
    const applied = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: form });
    assert.equal(applied.status, 201, await applied.clone().text());
    const cand = await db.candidate.findFirstOrThrow({
      where: { organizationId: orgA.id, email: `careers.${tag}@example.com` },
      include: { applications: true },
    });
    assert.equal(cand.applications.length, 1);
    assert.equal(cand.applications[0].jobId, openA.id);
    assert.equal(cand.applications[0].source, "careers_site");
    assert.equal(cand.applications[0].status, "ACTIVE");
    assert.equal(await db.aIEvaluation.count({ where: { application: { candidateId: cand.id } } }), 0, "no automatic screening");
    const html = (await get(`/dashboard/candidates?q=${tag}`, cookie.hr)).text;
    assert.match(html, new RegExp(`Careers Applicant${tag}`));
  });
} finally {
  await db.application.deleteMany({ where: { job: { organizationId: { in: orgIds } } } });
  await db.job.deleteMany({ where: { organizationId: { in: orgIds } } });
  await db.candidate.deleteMany({ where: { organizationId: { in: orgIds } } });
  await db.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.$disconnect();
}

for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
