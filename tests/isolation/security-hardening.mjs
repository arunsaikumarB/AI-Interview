/**
 * Security hardening regression: /api/candidates privacy + pagination, /api/documents/upload org
 * ownership, PDF page markers never stored or returned, careers limits not bypassed by a spoofed
 * X-Forwarded-For. Runs against a live server whose DATABASE_URL is a THROWAWAY database (name
 * ending in _test) and whose TRUST_PROXY is unset; creates and deletes its own data.
 *
 *   DATABASE_URL=postgresql://.../hireos_import_test BASE_URL=http://localhost:3002 \
 *     STORAGE_ROOT=<server's storage root> AUTH_SECRET=... node tests/isolation/security-hardening.mjs
 */
import assert from "node:assert/strict";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { BASE, mintCookie } from "./helpers.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.replace(/^\//, "").endsWith("_test")) {
  throw new Error("DATABASE_URL must point at a throwaway database whose name ends in _test.");
}
const STORAGE_ROOT = process.env.STORAGE_ROOT;
if (!STORAGE_ROOT) throw new Error("STORAGE_ROOT (the server's storage root) is required.");

const db = new PrismaClient({ datasources: { db: { url } } });
const tag = `sec${Date.now()}`;
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err instanceof Error ? err.message : String(err)]);
  }
}

/** Minimal one-page PDF with real extractable text; pdf-parse adds "-- 1 of 1 --" to its output. */
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

const MARKER = /--\s*\d+\s+of\s+\d+\s*--/;
const SECRET = `SECRET_RESUME_${tag}`;

async function get(cookie, path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, json, text };
}

async function upload(cookie, fields, file = ["cv.pdf", textPdf(["Kiran Kumar", "Spring Boot"])]) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", new Blob([file[1]], { type: "application/pdf" }), file[0]);
  const res = await fetch(`${BASE}/api/documents/upload`, {
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

async function resumeFiles() {
  try {
    return (await readdir(join(STORAGE_ROOT, "resumes"))).sort();
  } catch {
    return [];
  }
}

const orgA = await db.organization.create({ data: { name: `SEC A ${tag}`, slug: `${tag}-a` } });
const orgB = await db.organization.create({ data: { name: `SEC B ${tag}`, slug: `${tag}-b` } });
const mk = (role, org) =>
  db.user.create({
    data: { email: `${role.toLowerCase()}.${org.slug}@example.com`, name: role, role, passwordHash: "x", organizationId: org.id, isActive: true },
  });
const users = {
  hr: await mk("HR_ADMIN", orgA),
  interviewer: await mk("INTERVIEWER", orgA),
  candidate: await mk("CANDIDATE", orgA),
  hrB: await mk("HR_ADMIN", orgB),
};
const cookie = {};
for (const [k, u] of Object.entries(users)) cookie[k] = await mintCookie(u);

const jobA = await db.job.create({ data: { organizationId: orgA.id, title: `SEC Java ${tag}`, description: "d", status: "OPEN", createdById: users.hr.id } });

// 30 org A candidates; pairs share createdAt so the id tiebreaker is exercised.
const base = Date.UTC(2026, 0, 1);
for (let i = 0; i < 30; i++) {
  await db.candidate.create({
    data: {
      organizationId: orgA.id,
      email: `cand${i}.${tag}@example.com`,
      firstName: `Cand${i}`,
      lastName: tag,
      phone: `+1 555 01${String(i).padStart(2, "0")}`,
      resumeText: `${SECRET} number ${i}\n\n-- 1 of 1 --`,
      resumeUrl: `resumes/${tag}-${i}.pdf`,
      createdAt: new Date(base + Math.floor(i / 2) * 60_000),
    },
  });
}
for (let i = 0; i < 3; i++) {
  await db.candidate.create({
    data: { organizationId: orgB.id, email: `orgb${i}.${tag}@example.com`, firstName: `OrgB${i}`, lastName: tag, phone: "+1 555 0999" },
  });
}
const victim = await db.candidate.findFirstOrThrow({ where: { organizationId: orgA.id, firstName: "Cand0" } });
const victimApp = await db.application.create({ data: { candidateId: victim.id, jobId: jobA.id, stage: "APPLIED", status: "ACTIVE", source: "security_test" } });

const LIST_KEYS = ["applicationCount", "createdAt", "email", "experience", "firstName", "hasResume", "id", "lastName", "location", "skills", "updatedAt"];

try {
  // ── /api/candidates ──
  await check("candidates: no session → 401; CANDIDATE → 403", async () => {
    assert.equal((await get(null, "/api/candidates")).res.status, 401);
    assert.equal((await get(cookie.candidate, "/api/candidates")).res.status, 403);
  });

  await check("candidates: default page is 25 of own org, minimal fields, no-store", async () => {
    const r = await get(cookie.hr, "/api/candidates");
    assert.equal(r.res.status, 200);
    assert.equal(r.res.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(r.json).sort(), ["items", "page", "pageSize", "total", "totalPages"]);
    assert.equal(r.json.page, 1);
    assert.equal(r.json.pageSize, 25);
    assert.equal(r.json.total, 30);
    assert.equal(r.json.totalPages, 2);
    assert.equal(r.json.items.length, 25);
    for (const item of r.json.items) assert.deepEqual(Object.keys(item).sort(), LIST_KEYS);
    assert.doesNotMatch(r.text, new RegExp(`${SECRET}|\\+1 555|resumeText|resumeUrl|phone|organizationId|userId|passwordHash|OrgB`));
  });

  await check("candidates: ordered createdAt DESC, id DESC; page 2 continues without overlap", async () => {
    const expected = (
      await db.candidate.findMany({ where: { organizationId: orgA.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } })
    ).map((c) => c.id);
    const p1 = await get(cookie.hr, "/api/candidates?page=1");
    const p2 = await get(cookie.hr, "/api/candidates?page=2");
    assert.equal(p2.json.items.length, 5);
    assert.deepEqual([...p1.json.items, ...p2.json.items].map((c) => c.id), expected);
  });

  await check("candidates: pageSize max 100; invalid page/pageSize/q → 400; past the end → empty", async () => {
    const all = await get(cookie.hr, "/api/candidates?pageSize=100");
    assert.equal(all.res.status, 200);
    assert.equal(all.json.items.length, 30);
    for (const qs of ["pageSize=101", "pageSize=0", "pageSize=-5", "pageSize=abc", "pageSize=1.5", "page=0", "page=-1", "page=x", "pageSize=", `q=${"a".repeat(101)}`]) {
      const r = await get(cookie.hr, `/api/candidates?${qs}`);
      assert.equal(r.res.status, 400, qs);
      assert.doesNotMatch(r.text, /prisma|zod|stack|at \w+ \(/i, qs);
    }
    const past = await get(cookie.hr, "/api/candidates?page=99");
    assert.equal(past.res.status, 200);
    assert.equal(past.json.items.length, 0);
    assert.equal(past.json.total, 30);
  });

  await check("candidates: search is filtered in the database and stays in the org", async () => {
    const r = await get(cookie.hr, `/api/candidates?q=Cand17`);
    assert.deepEqual(r.json.items.map((c) => c.firstName), ["Cand17"]);
    assert.equal((await get(cookie.hr, `/api/candidates?q=OrgB1`)).json.total, 0);
  });

  await check("candidates: interviewer (staff) allowed; org B sees only its own 3", async () => {
    assert.equal((await get(cookie.interviewer, "/api/candidates")).res.status, 200);
    const b = await get(cookie.hrB, "/api/candidates");
    assert.equal(b.json.total, 3);
    assert.ok(b.json.items.every((c) => c.firstName.startsWith("OrgB")));
  });

  // ── /api/candidates/[id] + page markers ──
  await check("candidate detail: authorized HR gets resume text without page markers or storage path", async () => {
    const r = await get(cookie.hr, `/api/candidates/${victim.id}`);
    assert.equal(r.res.status, 200);
    assert.match(r.json.candidate.resumeText, new RegExp(`${SECRET} number 0`));
    assert.doesNotMatch(r.text, MARKER);
    assert.equal("resumeUrl" in r.json.candidate, false);
    assert.equal(r.json.candidate.hasResume, true);
  });

  await check("candidate detail: other org → 404, no data", async () => {
    const r = await get(cookie.hrB, `/api/candidates/${victim.id}`);
    assert.equal(r.res.status, 404);
    assert.doesNotMatch(r.text, new RegExp(SECRET));
  });

  // ── /api/documents/upload ──
  const before = { resumeUrl: victim.resumeUrl, resumeText: victim.resumeText };

  await check("upload: no session → 401 and nothing stored", async () => {
    const files = await resumeFiles();
    assert.equal((await upload(null, { candidateId: victim.id })).res.status, 401);
    assert.deepEqual(await resumeFiles(), files);
  });

  await check("upload: org B HR + org A candidateId → 404, nothing stored, candidate unchanged", async () => {
    const files = await resumeFiles();
    const r = await upload(cookie.hrB, { candidateId: victim.id });
    assert.equal(r.res.status, 404);
    assert.equal(r.json.error, "Candidate not found");
    assert.deepEqual(await resumeFiles(), files);
    const now = await db.candidate.findUniqueOrThrow({ where: { id: victim.id }, select: { resumeUrl: true, resumeText: true } });
    assert.deepEqual(now, before);
  });

  await check("upload: org B HR + org A applicationId → 404, nothing stored", async () => {
    const files = await resumeFiles();
    const r = await upload(cookie.hrB, { applicationId: victimApp.id });
    assert.equal(r.res.status, 404);
    assert.deepEqual(await resumeFiles(), files);
    assert.equal(await db.timelineEvent.count({ where: { applicationId: victimApp.id } }), 0);
  });

  await check("upload: application mixing an org A candidate with an org B job → 404 for both orgs", async () => {
    const jobB = await db.job.create({ data: { organizationId: orgB.id, title: `SEC B job ${tag}`, description: "d", status: "OPEN", createdById: users.hrB.id } });
    const mixed = await db.application.create({ data: { candidateId: victim.id, jobId: jobB.id, stage: "APPLIED", status: "ACTIVE", source: "security_test" } });
    const files = await resumeFiles();
    assert.equal((await upload(cookie.hr, { applicationId: mixed.id })).res.status, 404);
    assert.equal((await upload(cookie.hrB, { applicationId: mixed.id })).res.status, 404);
    assert.deepEqual(await resumeFiles(), files);
    await db.application.delete({ where: { id: mixed.id } });
  });

  await check("upload: interviewer → 403; malformed or unknown id → 400/404; nothing stored", async () => {
    const files = await resumeFiles();
    assert.equal((await upload(cookie.interviewer, { candidateId: victim.id })).res.status, 403);
    assert.equal((await upload(cookie.hr, { candidateId: "../../etc/passwd" })).res.status, 400);
    assert.equal((await upload(cookie.hr, { candidateId: "a".repeat(65) })).res.status, 400);
    assert.equal((await upload(cookie.hr, { candidateId: "doesnotexist000000000000" })).res.status, 404);
    assert.equal((await upload(cookie.hr, {})).res.status, 400);
    assert.deepEqual(await resumeFiles(), files);
  });

  await check("upload: org A HR + own candidate → 201; text stored without page markers; no storage path returned", async () => {
    const r = await upload(cookie.hr, { candidateId: victim.id });
    assert.equal(r.res.status, 201, r.text.slice(0, 200));
    assert.equal(r.json.parsed, true);
    assert.equal("resumeUrl" in r.json.candidate, false);
    const now = await db.candidate.findUniqueOrThrow({ where: { id: victim.id }, select: { resumeUrl: true, resumeText: true } });
    assert.notEqual(now.resumeUrl, before.resumeUrl);
    assert.match(now.resumeText, /Kiran Kumar/);
    assert.doesNotMatch(now.resumeText, MARKER);
    assert.ok((await stat(join(STORAGE_ROOT, now.resumeUrl))).size > 0);
  });

  await check("upload: org A HR + own application → 201 and a timeline event", async () => {
    const r = await upload(cookie.hr, { applicationId: victimApp.id });
    assert.equal(r.res.status, 201);
    assert.equal(await db.timelineEvent.count({ where: { applicationId: victimApp.id, type: "DOCUMENT_UPLOADED" } }), 1);
  });

  // ── careers apply: page markers + spoofed X-Forwarded-For ──
  const applicant = `applicant.${tag}@example.com`;
  async function apply(xff) {
    const form = new FormData();
    form.set("jobId", jobA.id);
    form.set("firstName", "Asha");
    form.set("lastName", tag);
    form.set("email", applicant);
    form.set("resume", new Blob([textPdf(["Asha Rao", "React developer"])], { type: "application/pdf" }), "asha.pdf");
    const res = await fetch(`${BASE}/api/careers/apply`, { method: "POST", headers: { "x-forwarded-for": xff }, body: form });
    return { res, text: await res.text() };
  }

  await check("careers apply: stored resume text has no page markers; response has no resume text", async () => {
    const r = await apply("203.0.113.1");
    assert.equal(r.res.status, 201, r.text.slice(0, 200));
    assert.doesNotMatch(r.text, /resumeText|Asha Rao/);
    const c = await db.candidate.findFirstOrThrow({ where: { organizationId: orgA.id, email: applicant }, select: { resumeText: true } });
    assert.match(c.resumeText, /Asha Rao/);
    assert.doesNotMatch(c.resumeText, MARKER);
  });

  await check("careers apply: rotating a spoofed X-Forwarded-For does not bypass the limit", async () => {
    const statuses = [];
    for (let i = 2; i <= 6; i++) statuses.push((await apply(`203.0.113.${i}`)).res.status);
    assert.deepEqual(statuses.slice(0, 4), [409, 409, 409, 409]);
    assert.equal(statuses[4], 429);
  });
} finally {
  const stored = await db.candidate.findMany({ where: { organizationId: { in: [orgA.id, orgB.id] } }, select: { resumeUrl: true } });
  for (const { resumeUrl } of stored) {
    if (resumeUrl && !resumeUrl.startsWith(`resumes/${tag}-`)) await rm(join(STORAGE_ROOT, resumeUrl), { force: true });
  }
  for (const f of await resumeFiles()) if (f.endsWith("-cv.pdf") || f.endsWith("-asha.pdf")) await rm(join(STORAGE_ROOT, "resumes", f), { force: true });
  const apps = { job: { organizationId: { in: [orgA.id, orgB.id] } } };
  await db.timelineEvent.deleteMany({ where: { application: apps } });
  await db.application.deleteMany({ where: apps });
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
