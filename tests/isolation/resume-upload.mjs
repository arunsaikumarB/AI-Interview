/**
 * HR resume upload route (/api/candidates/upload-resumes): access control, file and input
 * validation, org scoping and end-to-end visibility. Runs against a live server whose
 * DATABASE_URL is a THROWAWAY database (name ending in _test); creates and deletes its own data.
 *
 *   DATABASE_URL=postgresql://.../hireos_import_test BASE_URL=http://localhost:3001 \
 *     STORAGE_ROOT=<server's storage root> AUTH_SECRET=... node tests/isolation/resume-upload.mjs
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { BASE, COOKIE_NAME, mintCookie } from "./helpers.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("DATABASE_URL must point at a throwaway database whose name ends in _test.");
}

const ENDPOINT = "/api/candidates/upload-resumes";
const db = new PrismaClient({ datasources: { db: { url } } });
const tag = `ruiso${Date.now()}`;
const results = [];
const storedResumes = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err instanceof Error ? err.message : String(err)]);
  }
}

/** Minimal one-page PDF with real extractable text, one line per entry. */
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
  return new TextEncoder().encode(out);
}

async function send(cookie, { mode, files = [], jobId, rows, extra = {} }) {
  const form = new FormData();
  if (mode) form.set("mode", mode);
  if (jobId !== undefined) form.set("jobId", jobId);
  if (rows !== undefined) form.set("rows", typeof rows === "string" ? rows : JSON.stringify(rows));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  for (const [name, bytes, type = "application/pdf"] of files) form.append("files", new Blob([bytes], { type }), name);
  const res = await fetch(`${BASE}${ENDPOINT}`, { method: "POST", headers: cookie ? { Cookie: cookie } : {}, body: form });
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

const kiranEmail = `kiran.${tag}@example.com`;
const kiranPdf = textPdf(["Kiran Kumar", kiranEmail, "Phone: 9876543210", "5 years of experience in Spring Boot"]);
const kiranRow = { fileName: "kiran_cv.pdf", firstName: "Kiran", lastName: "Kumar", email: kiranEmail, phone: "9876543210", experience: 5 };

const orgA = await db.organization.create({ data: { name: `RU A ${tag}`, slug: `${tag}-a` } });
const orgB = await db.organization.create({ data: { name: `RU B ${tag}`, slug: `${tag}-b` } });
const mk = (role, org) =>
  db.user.create({
    data: { email: `${role.toLowerCase()}.${org.slug}@example.com`, name: role, role, passwordHash: "x", organizationId: org.id, isActive: true },
  });
const users = {
  hr: await mk("HR_ADMIN", orgA),
  recruiter: await mk("RECRUITER", orgA),
  interviewer: await mk("INTERVIEWER", orgA),
  manager: await mk("HIRING_MANAGER", orgA),
  candidate: await mk("CANDIDATE", orgA),
  hrB: await mk("HR_ADMIN", orgB),
};
const cookie = {};
for (const [k, u] of Object.entries(users)) cookie[k] = await mintCookie(u);
const jobA = await db.job.create({ data: { organizationId: orgA.id, title: `RU Java ${tag}`, description: "d", status: "OPEN", createdById: users.hr.id } });
const draftA = await db.job.create({ data: { organizationId: orgA.id, title: `RU Draft ${tag}`, description: "d", status: "DRAFT", createdById: users.hr.id } });
const jobB = await db.job.create({ data: { organizationId: orgB.id, title: `RU Secret ${tag}`, description: "d", status: "OPEN", createdById: users.hrB.id } });
const closedA = await db.job.create({ data: { organizationId: orgA.id, title: `RU Closed ${tag}`, description: "d", status: "CLOSED", createdById: users.hr.id } });

try {
  await check("no session → 401, forged cookie → 401", async () => {
    assert.equal((await send(null, { mode: "read", files: [["a.pdf", kiranPdf]] })).res.status, 401);
    const forged = await send(`${COOKIE_NAME}=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged`, { mode: "read", files: [["a.pdf", kiranPdf]] });
    assert.equal(forged.res.status, 401);
  });

  for (const role of ["candidate", "interviewer", "manager"]) {
    await check(`${role} → 403 and nothing written`, async () => {
      const r = await send(cookie[role], { mode: "save", files: [["kiran_cv.pdf", kiranPdf]], rows: [kiranRow] });
      assert.equal(r.res.status, 403);
      assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), 0);
    });
  }

  await check("read: details are suggested from the PDF text; nothing is written; no-store", async () => {
    const r = await send(cookie.hr, { mode: "read", files: [["kiran_cv.pdf", kiranPdf]], jobId: jobA.id });
    assert.equal(r.res.status, 200, r.text.slice(0, 200));
    assert.equal(r.res.headers.get("cache-control"), "no-store");
    const [res] = r.json.results;
    assert.equal(res.status, "new");
    assert.equal(res.parsed, true);
    assert.deepEqual(res.fields, { firstName: "Kiran", lastName: "Kumar", email: kiranEmail, phone: "9876543210", experience: 5 });
    assert.equal(res.needsOcr, false);
    assert.equal(typeof res.profile?.skills, "number");
    assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), 0);
  });

  await check("ocr: auth, roles and one-PDF-only are enforced", async () => {
    assert.equal((await send(null, { mode: "ocr", files: [["a.pdf", kiranPdf]] })).res.status, 401);
    for (const role of ["candidate", "interviewer", "manager"]) {
      assert.equal((await send(cookie[role], { mode: "ocr", files: [["a.pdf", kiranPdf]] })).res.status, 403, role);
    }
    const two = await send(cookie.hr, { mode: "ocr", files: [["a.pdf", kiranPdf], ["b.pdf", kiranPdf]] });
    assert.equal(two.res.status, 400);
    assertSafeError(two);
    const txt = await send(cookie.hr, { mode: "ocr", files: [["cv.txt", new TextEncoder().encode("Kiran"), "text/plain"]] });
    assert.equal(txt.json.results[0].status, "invalid");
    const fake = await send(cookie.hr, { mode: "ocr", files: [["fake.pdf", new TextEncoder().encode("MZ not a pdf")]] });
    assert.equal(fake.json.results[0].status, "invalid");
    assert.equal((await send(cookie.hr, { mode: "ocr", files: [["k.pdf", kiranPdf]], jobId: jobB.id })).res.status, 400, "other org job");
  });

  await check("ocr: a real PDF is read with local OCR on this server; nothing is written", async () => {
    const r = await send(cookie.hr, { mode: "ocr", files: [["kiran_cv.pdf", kiranPdf]] });
    assert.equal(r.res.status, 200, r.text.slice(0, 200));
    assert.equal(r.res.headers.get("cache-control"), "no-store");
    const [res] = r.json.results;
    assert.equal(res.ocr, true, "OCR produced text");
    assert.equal(res.fields.firstName, "Kiran");
    assert.equal(res.fields.phone, "9876543210");
    assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), 0);
  });

  await check("bad requests are refused with safe messages", async () => {
    const otherJob = await send(cookie.hr, { mode: "read", files: [["kiran_cv.pdf", kiranPdf]], jobId: jobB.id });
    assert.equal(otherJob.res.status, 400, "another organization's job");
    assertSafeError(otherJob);
    assert.equal((await send(cookie.hr, { mode: "read", files: [["k.pdf", kiranPdf]], jobId: closedA.id })).res.status, 400, "closed job");
    assert.equal((await send(cookie.hr, { mode: "read", files: [["k.pdf", kiranPdf]], jobId: draftA.id })).res.status, 400, "draft job");
    assert.equal((await send(cookie.hr, { mode: "read", files: [["k.pdf", kiranPdf]], jobId: "x".repeat(200) })).res.status, 400);
    assert.equal((await send(cookie.hr, { mode: "nope", files: [["k.pdf", kiranPdf]] })).res.status, 400);
    assert.equal((await send(cookie.hr, { mode: "read" })).res.status, 400, "no files");
    const many = Array.from({ length: 21 }, (_, i) => [`f${i}.pdf`, kiranPdf]);
    assert.equal((await send(cookie.hr, { mode: "read", files: many })).res.status, 400, "21 files");
    const big = new Uint8Array(14 * 1024 * 1024);
    const huge = await send(cookie.hr, { mode: "read", files: [["a.pdf", big], ["b.pdf", big], ["c.pdf", big]] });
    assert.equal(huge.res.status, 413);
    const mismatch = await send(cookie.hr, { mode: "save", files: [["kiran_cv.pdf", kiranPdf]], rows: [{ ...kiranRow, fileName: "other.pdf" }] });
    assert.equal(mismatch.res.status, 400, "rows that do not match the files");
    for (const bad of [[], [{ ...kiranRow, email: "nope" }], [{ ...kiranRow, firstName: "" }], "not json"]) {
      const r = await send(cookie.hr, { mode: "save", files: [["kiran_cv.pdf", kiranPdf]], rows: bad });
      assert.equal(r.res.status, 400, `rows ${JSON.stringify(bad).slice(0, 40)}`);
      assertSafeError(r);
    }
    const fake = await send(cookie.hr, { mode: "save", files: [["fake.pdf", new TextEncoder().encode("MZ not a pdf")]], rows: [{ ...kiranRow, fileName: "fake.pdf" }] });
    assert.equal(fake.json.results[0].status, "invalid");
    assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), 0);
  });

  await check("save (recruiter, with job): candidate + application in the session org only", async () => {
    const r = await send(cookie.recruiter, {
      mode: "save",
      files: [["kiran_cv.pdf", kiranPdf]],
      rows: [kiranRow],
      jobId: jobA.id,
      extra: { organizationId: orgB.id },
    });
    assert.equal(r.res.status, 200, r.text.slice(0, 200));
    assert.deepEqual(r.json.results, [{ name: "kiran_cv.pdf", status: "created", parsed: true }]);
    const c = await db.candidate.findFirstOrThrow({ where: { email: kiranEmail }, include: { applications: true } });
    assert.equal(c.organizationId, orgA.id);
    assert.equal(c.experience, 5);
    assert.match(c.resumeText ?? "", /Spring Boot/);
    assert.equal(c.applications.length, 1);
    assert.equal(c.applications[0].jobId, jobA.id);
    assert.equal(c.applications[0].stage, "APPLIED");
    assert.equal(c.applications[0].status, "ACTIVE");
    assert.equal(c.firstName, "Kiran", "the AI never changes the name");
    storedResumes.push(c.resumeUrl);
    assert.equal(await db.candidate.count({ where: { organizationId: orgB.id } }), 0);
  });

  await check("re-upload does not duplicate; resume opens only for the same organization", async () => {
    const again = await send(cookie.hr, { mode: "save", files: [["kiran_cv.pdf", kiranPdf]], rows: [{ ...kiranRow, firstName: "Changed" }], jobId: jobA.id });
    assert.equal(again.json.results[0].status, "already_applied");
    const read = await send(cookie.hr, { mode: "read", files: [["kiran_cv.pdf", kiranPdf]] });
    assert.equal(read.json.results[0].status, "exists");
    const c = await db.candidate.findFirstOrThrow({ where: { email: kiranEmail } });
    assert.equal(c.firstName, "Kiran");
    assert.equal(await db.candidate.count({ where: { email: kiranEmail } }), 1);
    const view = await fetch(`${BASE}/api/candidates/${c.id}/resume`, { headers: { Cookie: cookie.hr } });
    assert.equal(view.status, 200);
    assert.equal(view.headers.get("content-type"), "application/pdf");
    assert.equal((await fetch(`${BASE}/api/candidates/${c.id}/resume`, { headers: { Cookie: cookie.hrB } })).status, 404);
  });

  await check("Candidates page: HR sees the candidate and the Upload resumes button; other org and interviewer do not", async () => {
    const list = await fetch(`${BASE}/dashboard/candidates?q=${encodeURIComponent(tag)}`, { headers: { Cookie: cookie.hr } }).then((r) => r.text());
    assert.match(list, /Kiran/);
    assert.match(list, /Upload resumes/);
    const other = await fetch(`${BASE}/dashboard/candidates?q=${encodeURIComponent(tag)}`, { headers: { Cookie: cookie.hrB } }).then((r) => r.text());
    assert.doesNotMatch(other, /Kiran/);
    const interviewer = await fetch(`${BASE}/dashboard/candidates?q=${encodeURIComponent(tag)}`, { headers: { Cookie: cookie.interviewer } }).then((r) => r.text());
    assert.doesNotMatch(interviewer, /Upload resumes/);
  });

  await check("upload page: HR sees the uploader and only own-org open jobs; interviewer is redirected", async () => {
    const ok = await fetch(`${BASE}/dashboard/candidates/import`, { headers: { Cookie: cookie.hr } });
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.match(html, /ru-files/);
    assert.match(html, new RegExp(`RU Java ${tag}`));
    assert.doesNotMatch(html, new RegExp(`RU Secret ${tag}|RU Closed ${tag}`));
    assert.doesNotMatch(html, /rp-file|Step 1/);
    const denied = await fetch(`${BASE}/dashboard/candidates/import`, { headers: { Cookie: cookie.interviewer }, redirect: "manual" });
    if ([303, 307, 308].includes(denied.status)) {
      assert.match(denied.headers.get("location") ?? "", /\/dashboard\/candidates$/);
    } else {
      const body = await denied.text();
      assert.match(body, /NEXT_REDIRECT;(replace|push);\/dashboard\/candidates;/);
      assert.doesNotMatch(body, /ru-files/);
    }
  });
} finally {
  if (process.env.STORAGE_ROOT) {
    const { rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    for (const rel of storedResumes) if (rel) await rm(join(process.env.STORAGE_ROOT, rel), { force: true });
  }
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
