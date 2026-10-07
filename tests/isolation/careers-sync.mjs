/**
 * Careers site sync over HTTP: "Sync now" and status, with role checks, organization isolation,
 * safe responses, de-duplication, closing expired jobs and advisory AI screening for new
 * applicants only. Starts its own mock careers site (GET /wp-json/careers/v1/live-applications
 * and /<id>/resume, Bearer key) and a decoy at the address put in `resume_url`, which must never
 * be called.
 *
 * The HireOS server must run against a THROWAWAY database with
 *   CAREERS_API_URL=http://127.0.0.1:<MOCK_PORT>  CAREERS_API_KEY=<same key as here>
 *   CAREERS_ORGANIZATION_ID=careers-http-org-test  CAREERS_SYNC_INTERVAL_MINUTES=0
 *
 *   DATABASE_URL=postgresql://.../hireos_import_test BASE_URL=http://localhost:3002 STORAGE_ROOT=<server's> \
 *     AUTH_SECRET=... CAREERS_API_KEY=... MOCK_PORT=8097 DECOY_PORT=8096 node tests/isolation/careers-sync.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { BASE, mintCookie } from "./helpers.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("DATABASE_URL must point at a throwaway database whose name ends in _test.");
}
const STORAGE_ROOT = process.env.STORAGE_ROOT;
const KEY = process.env.CAREERS_API_KEY;
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8097);
const DECOY_PORT = Number(process.env.DECOY_PORT ?? 8096);
const ORG_ID = "careers-http-org-test";
if (!STORAGE_ROOT || !KEY) throw new Error("STORAGE_ROOT and CAREERS_API_KEY are required.");

const db = new PrismaClient({ datasources: { db: { url } } });
const tag = `cs${Date.now()}`;
const results = [];
const SCREENING_WAIT_MS = Number(process.env.SCREENING_WAIT_MS ?? 300_000);

async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err instanceof Error ? err.message : String(err)]);
  }
}

function textPdf(lines) {
  const body = lines.map((l, i) => `${i === 0 ? "" : "0 -20 Td "}(${l.replace(/[()\\]/g, "")}) Tj`).join(" ");
  const content = `BT /F1 12 Tf 72 720 Td ${body} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------------------------------------------------------------- mock careers site
const existingEmail = `existing.${tag}@example.test`;
const app = (id, over = {}) => ({
  application_id: id,
  applied_on: "2026-10-01 10:00:00",
  applicant_name: `Applicant ${id}`,
  applicant_email: `a${id}.${tag}@example.test`,
  applicant_phone: "+91 98765 43210",
  job_id: 701,
  job_title: "Python Developer &#8211; Hyderabad",
  cover_letter: `<p>Cover letter ${id}</p>`,
  total_experience: "6 years",
  relevant_experience: "4 years",
  skills_exposure: "Python, Django, SQL",
  education: "B.Tech",
  hometown: "Vizag",
  current_town: "Hyderabad",
  current_ctc: "10 LPA",
  expected_ctc: "14 LPA",
  notice_period: "30 days",
  tentative_joining: "",
  interview_availability: "Weekdays",
  reason_leaving: "Growth",
  linkedin_url: "https://linkedin.com/in/someone",
  attachment_id: 9000 + id,
  resume_filename: `cv-${id}.pdf`,
  ftp_file_path: "/srv/ftp/../../etc/passwd",
  resume_url: `http://127.0.0.1:${DECOY_PORT}/steal/${id}`,
  ...over,
});
let live = [
  app(1),
  app(2, { applicant_email: existingEmail.toUpperCase(), applicant_name: "Renamed Person" }),
  app(3, { job_id: 702, job_title: "QA &amp; Test Engineer" }),
  app(4, { applicant_email: "not-an-email" }),
];
const files = {
  1: textPdf(["Applicant One", `SECRET_TEXT_${tag}`, "Python Django SQL, 6 years"]),
  3: textPdf(["Applicant Three", "Selenium testing"]),
  5: textPdf(["Applicant Five", "Python developer, 6 years", "Django, SQL, REST APIs", "Built payment services in Python"]),
};
const mockLog = [];
let decoyHits = 0;
let listDelayMs = 0;

const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  mockLog.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization });
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    res.writeHead(401, { "Content-Type": "application/json" }).end('{"code":"rest_forbidden"}');
    return;
  }
  if (u.pathname === "/wp-json/careers/v1/live-applications") {
    if (listDelayMs) await new Promise((r) => setTimeout(r, listDelayMs));
    const page = Number(u.searchParams.get("page") ?? 1);
    const perPage = Number(u.searchParams.get("per_page") ?? 20);
    const after = u.searchParams.get("after");
    const rows = after ? live.filter((a) => a.applied_on > after) : live;
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        success: true,
        page,
        per_page: perPage,
        count: Math.min(perPage, Math.max(0, rows.length - (page - 1) * perPage)),
        total: rows.length,
        total_pages: Math.ceil(rows.length / perPage),
        applications: rows.slice((page - 1) * perPage, page * perPage),
      }),
    );
    return;
  }
  const m = /^\/wp-json\/careers\/v1\/live-applications\/(\d+)\/resume$/.exec(u.pathname);
  const file = m && live.some((a) => String(a.application_id) === m[1]) ? files[m[1]] : undefined;
  if (!file) {
    res.writeHead(404).end('{"code":"not_found"}');
    return;
  }
  res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="cv-${m[1]}.pdf"` }).end(file);
});
const decoy = createServer((req, res) => {
  decoyHits++;
  res.writeHead(200).end("stolen");
});

// ---------------------------------------------------------------- HireOS helpers
async function call(cookie, method, path) {
  const res = await fetch(`${BASE}${path}`, { method, headers: cookie ? { Cookie: cookie } : {} });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, json, text };
}
const status = (cookie) => call(cookie, "GET", "/api/integrations/careers/sync");
const syncNow = (cookie) => call(cookie, "POST", "/api/integrations/careers/sync");

async function waitIdle(cookie, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await status(cookie);
    if (s.res.status === 200 && s.json?.running === false && s.json?.lastRun) return s.json;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("sync did not finish in time");
}

const users = {};
const cookies = {};
let orgB;
let existingId;

async function seed() {
  await db.organization.create({ data: { id: ORG_ID, name: `Careers A ${tag}`, slug: `${tag}-a` } });
  orgB = await db.organization.create({ data: { name: `Careers B ${tag}`, slug: `${tag}-b` } });
  const mk = async (key, role, organizationId) => {
    users[key] = await db.user.create({
      data: { email: `${key}.${tag}@example.test`, passwordHash: "x", name: key, role, organizationId, isActive: true },
    });
    cookies[key] = await mintCookie(users[key]);
  };
  await mk("hr", "HR_ADMIN", ORG_ID);
  await mk("admin", "SUPER_ADMIN", ORG_ID);
  await mk("recruiter", "RECRUITER", ORG_ID);
  await mk("manager", "HIRING_MANAGER", ORG_ID);
  await mk("interviewer", "INTERVIEWER", ORG_ID);
  await mk("hrB", "HR_ADMIN", orgB.id);
  existingId = (
    await db.candidate.create({
      data: { organizationId: ORG_ID, email: existingEmail, firstName: "Existing", lastName: "Person", phone: "111", skills: ["Kept"] },
    })
  ).id;
}

async function cleanup() {
  const orgIds = [ORG_ID, orgB?.id].filter(Boolean);
  const cands = await db.candidate.findMany({ where: { organizationId: { in: orgIds } }, select: { resumeUrl: true } });
  for (const c of cands) {
    if (c.resumeUrl) await rm(join(STORAGE_ROOT, c.resumeUrl), { force: true });
  }
  await db.candidate.deleteMany({ where: { organizationId: { in: orgIds } } });
  await db.job.deleteMany({ where: { organizationId: { in: orgIds } } });
  await db.user.deleteMany({ where: { email: { endsWith: `.${tag}@example.test` } } });
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await rm(join(STORAGE_ROOT, "integrations", "careers-sync.json"), { force: true });
}

const careersJob = (externalId) =>
  db.job.findFirst({ where: { organizationId: ORG_ID, externalSource: "wordpress_careers", externalId } });
const careersApp = (externalId) =>
  db.application.findFirst({
    where: { externalSource: "wordpress_careers", externalId, job: { organizationId: ORG_ID } },
    include: { candidate: true, timelineEvents: true },
  });

// ---------------------------------------------------------------- run
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
await new Promise((r) => decoy.listen(DECOY_PORT, "127.0.0.1", r));
await rm(join(STORAGE_ROOT, "integrations", "careers-sync.json"), { force: true });
await seed();

try {
  await check("signed-out callers are refused", async () => {
    assert.equal((await status(null)).res.status, 401);
    assert.equal((await syncNow(null)).res.status, 401);
  });

  await check("only HR admins and super admins may see or start the sync", async () => {
    for (const who of ["recruiter", "manager", "interviewer"]) {
      assert.equal((await status(cookies[who])).res.status, 403, `${who} status`);
      assert.equal((await syncNow(cookies[who])).res.status, 403, `${who} sync`);
    }
  });

  await check("an admin of another organization is refused", async () => {
    assert.equal((await status(cookies.hrB)).res.status, 403);
    assert.equal((await syncNow(cookies.hrB)).res.status, 403);
  });

  await check("status before the first sync", async () => {
    const s = await status(cookies.hr);
    assert.equal(s.res.status, 200);
    assert.equal(s.res.headers.get("cache-control"), "no-store");
    assert.deepEqual(
      { configured: s.json.configured, running: s.json.running, initialImportDone: s.json.initialImportDone, lastRun: s.json.lastRun },
      { configured: true, running: false, initialImportDone: false, lastRun: null },
    );
    assert.equal(s.json.intervalMinutes, 0);
    assert.doesNotMatch(s.text, new RegExp(KEY));
  });

  await check("Sync now starts in the background; a second start while running is refused", async () => {
    listDelayMs = 1500;
    const first = await syncNow(cookies.hr);
    assert.equal(first.res.status, 202);
    assert.deepEqual(first.json, { started: true });
    const second = await syncNow(cookies.admin);
    assert.equal(second.res.status, 409);
    listDelayMs = 0;
  });

  let firstReport;
  await check("the first import brings in jobs and applicants without AI screening", async () => {
    const s = await waitIdle(cookies.hr);
    firstReport = s.lastRun.report;
    assert.equal(s.lastRun.trigger, "manual");
    assert.equal(s.initialImportDone, true);
    assert.deepEqual(
      [firstReport.mode, firstReport.complete, firstReport.error, firstReport.seen],
      ["full", true, null, 4],
    );
    assert.deepEqual(
      [firstReport.created, firstReport.linked, firstReport.invalid, firstReport.jobsCreated, firstReport.screeningQueued],
      [2, 1, 1, 2, 0],
    );
    assert.doesNotMatch(JSON.stringify(s), /example\.test|Applicant|SECRET_TEXT/);
  });

  await check("careers jobs appear in Jobs & Candidates with clean titles, marked as from the careers page", async () => {
    const j701 = await careersJob("701");
    const j702 = await careersJob("702");
    assert.equal(j701?.title, "Python Developer – Hyderabad");
    assert.equal(j702?.title, "QA & Test Engineer");
    assert.equal(j701?.status, "OPEN");
    assert.equal(j701?.createdById, users.hr.id);
    const page = await call(cookies.hr, "GET", "/dashboard/jobs");
    assert.equal(page.res.status, 200);
    assert.match(page.text, /Python Developer – Hyderabad/);
    assert.match(page.text, /From careers page/);
  });

  await check("applicants are candidates on the right job, at Applied, with resume and form answers", async () => {
    const a1 = await careersApp("1");
    assert.ok(a1);
    assert.equal(a1.jobId, (await careersJob("701")).id);
    assert.deepEqual([a1.stage, a1.status, a1.source], ["APPLIED", "ACTIVE", "careers_site"]);
    assert.match(a1.coverNote, /Expected CTC: 14 LPA/);
    assert.match(a1.coverNote, /Cover letter:\nCover letter 1/);
    assert.equal(a1.candidate.email, `a1.${tag}@example.test`);
    assert.equal(a1.candidate.experience, 6);
    assert.match(a1.candidate.resumeText ?? "", new RegExp(`SECRET_TEXT_${tag}`));
    await stat(join(STORAGE_ROOT, a1.candidate.resumeUrl));
    assert.deepEqual(a1.timelineEvents.map((e) => e.type).sort(), ["APPLICATION_CREATED", "DOCUMENT_UPLOADED"]);
    const a3 = await careersApp("3");
    assert.equal(a3?.jobId, (await careersJob("702")).id);
  });

  await check("an existing candidate only gains the application and is not changed or re-downloaded", async () => {
    const a2 = await careersApp("2");
    assert.equal(a2?.candidateId, existingId);
    const c = await db.candidate.findUniqueOrThrow({ where: { id: existingId } });
    assert.deepEqual([c.firstName, c.phone, c.skills, c.resumeUrl], ["Existing", "111", ["Kept"], null]);
    assert.ok(!mockLog.some((l) => l.path.endsWith("/2/resume")));
  });

  await check("the candidate page shows the source and the application form to staff", async () => {
    const a1 = await careersApp("1");
    const page = await call(cookies.hr, "GET", `/dashboard/candidates/${a1.candidateId}?applicationId=${a1.id}`);
    assert.equal(page.res.status, 200);
    assert.match(page.text, /Source: LogiSoft careers page/);
    assert.match(page.text, /Application form/);
    assert.match(page.text, /Notice period: 30 days/);
  });

  await check("every call to the careers site carried the key; resume_url was never used", async () => {
    assert.ok(mockLog.length > 0);
    assert.ok(mockLog.every((l) => l.auth === `Bearer ${KEY}`));
    assert.equal(decoyHits, 0);
    assert.ok(mockLog.every((l) => !l.path.includes("passwd")));
  });

  await check("syncing again imports nothing twice", async () => {
    const before = await db.application.count({ where: { job: { organizationId: ORG_ID } } });
    assert.equal((await syncNow(cookies.hr)).res.status, 202);
    const s = await waitIdle(cookies.hr);
    assert.ok(new Date(s.lastRun.startedAt) > new Date(0));
    assert.equal(s.lastRun.report.alreadyImported, 3);
    assert.equal(s.lastRun.report.created + s.lastRun.report.linked, 0);
    assert.equal(await db.application.count({ where: { job: { organizationId: ORG_ID } } }), before);
  });

  await check("a new applicant gets advisory AI screening; the stage does not change", async () => {
    live = [...live, app(5, { applied_on: "2026-10-07 09:00:00" })];
    assert.equal((await syncNow(cookies.hr)).res.status, 202);
    const s = await waitIdle(cookies.hr);
    assert.equal(s.lastRun.report.created, 1);
    assert.equal(s.lastRun.report.screeningQueued, 1);
    const a5 = await careersApp("5");
    assert.ok(a5);
    const until = Date.now() + SCREENING_WAIT_MS;
    let outcome = null;
    while (Date.now() < until && !outcome) {
      const evals = await db.aIEvaluation.count({ where: { applicationId: a5.id, kind: "RESUME_SCREEN" } });
      const failed = await db.timelineEvent.count({
        where: { applicationId: a5.id, type: "OTHER", payload: { path: ["kind"], equals: "ai_screening_failed" } },
      });
      if (evals > 0) outcome = "evaluated";
      else if (failed > 0) outcome = "failed (recorded)";
      else await new Promise((r) => setTimeout(r, 2000));
    }
    assert.ok(outcome, "screening finished or recorded a failure");
    results.push(["INFO", `new applicant screening outcome: ${outcome}`]);
    const after = await db.application.findUniqueOrThrow({ where: { id: a5.id } });
    assert.deepEqual([after.stage, after.status], ["APPLIED", "ACTIVE"]);
    // Older applicants from the first import were never screened.
    const a1 = await careersApp("1");
    assert.equal(await db.aIEvaluation.count({ where: { applicationId: a1.id } }), 0);
  });

  await check("an expired careers job is closed; its people and history stay", async () => {
    live = live.filter((a) => a.job_id !== 702);
    const j702 = await careersJob("702");
    const appsBefore = await db.application.count({ where: { jobId: j702.id } });
    assert.equal((await syncNow(cookies.hr)).res.status, 202);
    const s = await waitIdle(cookies.hr);
    assert.equal(s.lastRun.report.jobsClosed, 1);
    assert.equal((await careersJob("702")).status, "CLOSED");
    assert.equal((await careersJob("701")).status, "OPEN");
    assert.equal(await db.application.count({ where: { jobId: j702.id } }), appsBefore);
    assert.ok(await careersApp("3"));
  });

  await check("a careers site that rejects the key stops the run safely and closes nothing", async () => {
    const realKey = `Bearer ${KEY}`;
    const keep = mock.listeners("request")[0];
    mock.removeAllListeners("request");
    mock.on("request", (req, res) => {
      mockLog.push({ path: req.url, auth: req.headers.authorization === realKey ? "ok" : "bad" });
      res.writeHead(401).end('{"code":"rest_forbidden"}');
    });
    try {
      assert.equal((await syncNow(cookies.hr)).res.status, 202);
      const s = await waitIdle(cookies.hr);
      assert.deepEqual([s.lastRun.report.complete, s.lastRun.report.error, s.lastRun.report.jobsClosed], [false, "rejected_key", 0]);
      assert.equal((await careersJob("701")).status, "OPEN");
    } finally {
      mock.removeAllListeners("request");
      mock.on("request", keep);
    }
  });
} finally {
  await cleanup().catch((err) => results.push(["FAIL", "cleanup", String(err)]));
  await db.$disconnect();
  mock.close();
  decoy.close();
}

for (const [s, name, detail] of results) console.log(`${s}  ${name}${detail ? ` — ${detail}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
