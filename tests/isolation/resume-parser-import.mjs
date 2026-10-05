/**
 * Resume Parser CSV import route: access control, file validation, org scoping and
 * end-to-end visibility. Runs against a live server whose DATABASE_URL is a THROWAWAY
 * database (name ending in _test); this script creates and deletes its own org/users.
 *
 *   DATABASE_URL=postgresql://.../hireos_import_test BASE_URL=http://localhost:3001 \
 *     AUTH_SECRET=... node tests/isolation/resume-parser-import.mjs
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { BASE, COOKIE_NAME, mintCookie } from "./helpers.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("DATABASE_URL must point at a throwaway database whose name ends in _test.");
}

const ENDPOINT = "/api/candidates/import/resume-parser";
const db = new PrismaClient({ datasources: { db: { url } } });
const tag = `rpiso${Date.now()}`;
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err instanceof Error ? err.message : String(err)]);
  }
}

function csvBlob(text) {
  return new Blob([text], { type: "text/csv" });
}

async function upload(cookie, { mode, file, fileName = "export.csv", mapping, extra = {} }) {
  const form = new FormData();
  if (mode) form.set("mode", mode);
  if (file) form.set("file", file, fileName);
  if (mapping !== undefined) form.set("mapping", typeof mapping === "string" ? mapping : JSON.stringify(mapping));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const res = await fetch(`${BASE}${ENDPOINT}`, {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {},
    body: form,
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

const csv = [
  "Applicant ID,Candidate Name,Email,Applied Role,Experience,Applied Date,Resume File",
  `ISO-1,Iso Ravi,ravi.${tag}@example.com,Iso Java Developer,3,15/03/2025,ravi.pdf`,
  `ISO-2,Iso Ravi,ravi.${tag}@example.com,Iso Tester,3,16/03/2025,ravi.pdf`,
  `ISO-3,Iso Asha,asha.${tag}@example.com,Iso Tester,Fresher,,`,
  `ISO-4,Bad Row,not-an-email,Iso Tester,,,`,
].join("\n");
const mapping = {
  columns: { externalId: 0, fullName: 1, email: 2, jobRole: 3, experience: 4, appliedAt: 5, resumeReference: 6 },
  dateFormat: "DMY",
};

const orgA = await db.organization.create({ data: { name: `Iso A ${tag}`, slug: `${tag}-a` } });
const orgB = await db.organization.create({ data: { name: `Iso B ${tag}`, slug: `${tag}-b` } });
const mk = (role, org, extra = {}) =>
  db.user.create({
    data: { email: `${role.toLowerCase()}.${org.slug}@example.com`, name: role, role, passwordHash: "x", organizationId: org.id, isActive: true, ...extra },
  });
const users = {
  hr: await mk("HR_ADMIN", orgA),
  recruiter: await mk("RECRUITER", orgA),
  interviewer: await mk("INTERVIEWER", orgA),
  manager: await mk("HIRING_MANAGER", orgA),
  candidate: await mk("CANDIDATE", orgA),
  inactive: await db.user.create({
    data: { email: `inactive.${tag}@example.com`, name: "Inactive", role: "HR_ADMIN", passwordHash: "x", organizationId: orgA.id, isActive: false },
  }),
  hrB: await mk("HR_ADMIN", orgB),
};
const cookie = {};
for (const [k, u] of Object.entries(users)) cookie[k] = await mintCookie(u);

try {
  await check("no session → 401", async () => {
    const r = await upload(null, { mode: "columns", file: csvBlob(csv) });
    assert.equal(r.res.status, 401);
  });
  await check("forged session cookie → 401", async () => {
    const r = await upload(`${COOKIE_NAME}=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged`, { mode: "columns", file: csvBlob(csv) });
    assert.equal(r.res.status, 401);
  });
  await check("inactive HR user → 401", async () => {
    const r = await upload(cookie.inactive, { mode: "columns", file: csvBlob(csv) });
    assert.equal(r.res.status, 401);
  });
  for (const role of ["candidate", "interviewer", "manager"]) {
    await check(`${role} → 403 and nothing written`, async () => {
      const r = await upload(cookie[role], { mode: "import", file: csvBlob(csv), mapping });
      assert.equal(r.res.status, 403);
      assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), 0);
    });
  }

  await check("non-.csv file name → 400", async () => {
    const r = await upload(cookie.hr, { mode: "columns", file: csvBlob(csv), fileName: "export.xlsx" });
    assert.equal(r.res.status, 400);
    assertSafeError(r);
  });
  await check("empty file → 400", async () => {
    const r = await upload(cookie.hr, { mode: "columns", file: csvBlob("") });
    assert.equal(r.res.status, 400);
    assert.match(r.json.error, /empty/);
  });
  await check("binary file renamed .csv → 400", async () => {
    const r = await upload(cookie.hr, { mode: "columns", file: new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 1])]) });
    assert.equal(r.res.status, 400);
    assertSafeError(r);
  });
  await check("missing file / unknown action → 400", async () => {
    assert.equal((await upload(cookie.hr, { mode: "columns" })).res.status, 400);
    assert.equal((await upload(cookie.hr, { mode: "drop-tables", file: csvBlob(csv) })).res.status, 400);
  });
  await check("malformed or unknown-field mapping → 400", async () => {
    assert.equal((await upload(cookie.hr, { mode: "validate", file: csvBlob(csv), mapping: "{not json" })).res.status, 400);
    assert.equal((await upload(cookie.hr, { mode: "validate", file: csvBlob(csv), mapping: { columns: { path: 1 } } })).res.status, 400);
  });
  await check("required columns not chosen → 400 with reason", async () => {
    const r = await upload(cookie.hr, { mode: "validate", file: csvBlob(csv), mapping: { columns: { fullName: 1 } } });
    assert.equal(r.res.status, 400);
    assert.match(r.json.error, /Email/);
    assert.match(r.json.error, /Job role/);
  });

  await check("columns: headings, sample and suggested mapping; no-store", async () => {
    const r = await upload(cookie.hr, { mode: "columns", file: csvBlob(csv) });
    assert.equal(r.res.status, 200);
    assert.equal(r.res.headers.get("cache-control"), "no-store");
    assert.equal(r.json.rowCount, 4);
    assert.equal(r.json.header[2], "Email");
    assert.equal(r.json.sample.length, 3);
    assert.equal(r.json.suggested.email, 2);
  });

  await check("validate writes nothing", async () => {
    const r = await upload(cookie.hr, { mode: "validate", file: csvBlob(csv), mapping });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.applied, false);
    assert.equal(r.json.applicationsNew, 3);
    assert.equal(r.json.errorRows, 1);
    assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), 0);
    assert.equal(await db.job.count({ where: { organizationId: orgA.id } }), 0);
  });

  await check("import uses the session org even if the form names another org", async () => {
    const r = await upload(cookie.hr, { mode: "import", file: csvBlob(csv), mapping, extra: { organizationId: orgB.id } });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.applied, true);
    assert.equal(r.json.applicationsNew, 3);
    assert.equal(r.json.candidatesNew, 2);
    assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), 2);
    assert.equal(await db.candidate.count({ where: { organizationId: orgB.id } }), 0);
    const jobs = await db.job.findMany({ where: { organizationId: orgA.id }, select: { status: true, createdById: true } });
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((j) => j.status === "CLOSED" && j.createdById === users.hr.id));
  });

  await check("recruiter re-upload of the same file creates no duplicates", async () => {
    const r = await upload(cookie.recruiter, { mode: "import", file: csvBlob(csv), mapping });
    assert.equal(r.res.status, 200);
    assert.equal(r.json.applicationsNew, 0);
    assert.equal(r.json.duplicatesExisting, 3);
    assert.equal(await db.application.count({ where: { job: { organizationId: orgA.id } } }), 3);
  });

  await check("other org's HR sees none of it", async () => {
    const res = await fetch(`${BASE}/dashboard/candidates?q=${encodeURIComponent(tag)}`, { headers: { Cookie: cookie.hrB } });
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), new RegExp(`ravi\\.${tag}`));
  });

  await check("imported candidates appear in Candidates with the Resume Parser label", async () => {
    const res = await fetch(`${BASE}/dashboard/candidates?q=${encodeURIComponent(tag)}`, { headers: { Cookie: cookie.hr } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Iso Ravi/);
    assert.match(html, /Iso Asha/);
    assert.match(html, /Resume Parser/);
    assert.match(html, /On hold/);
    assert.match(html, /Import from (<!-- -->)?Resume Parser/);
  });

  await check("import page: HR sees the uploader, interviewer is redirected", async () => {
    const ok = await fetch(`${BASE}/dashboard/candidates/import`, { headers: { Cookie: cookie.hr } });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /rp-file/);
    const denied = await fetch(`${BASE}/dashboard/candidates/import`, { headers: { Cookie: cookie.interviewer }, redirect: "manual" });
    if ([303, 307, 308].includes(denied.status)) {
      assert.match(denied.headers.get("location") ?? "", /\/dashboard\/candidates$/);
    } else {
      // Streamed response: Next sends the redirect in the payload once the layout has started.
      const body = await denied.text();
      assert.match(body, /NEXT_REDIRECT;(replace|push);\/dashboard\/candidates;/);
      assert.doesNotMatch(body, /rp-file/);
    }
    const list = await fetch(`${BASE}/dashboard/candidates?q=${encodeURIComponent(tag)}`, { headers: { Cookie: cookie.interviewer } });
    assert.doesNotMatch(await list.text(), /Import from (<!-- -->)?Resume Parser/);
  });

  await check("untouched imports stay off the pipeline board and stage counts", async () => {
    const board = await fetch(`${BASE}/api/applications/board`, { headers: { Cookie: cookie.hr } }).then((r) => r.json());
    const all = Object.values(board.columns).flat();
    assert.equal(all.length, 0);
    const counts = await fetch(`${BASE}/api/applications/pipeline-counts`, { headers: { Cookie: cookie.hr } }).then((r) => r.json());
    assert.equal(Object.values(counts.counts).reduce((a, b) => a + b, 0), 0);
  });
} finally {
  await db.job.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await db.candidate.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await db.user.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  await db.$disconnect();
}

for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
