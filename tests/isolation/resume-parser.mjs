/**
 * Resume Parser integration over HTTP: skill search and Add to job, with role checks,
 * organization isolation, input validation, safe error messages and file checks. Starts its own
 * mock Resume Parser (spec: GET /api/v1/external/profiles/search/ and /<id>/resume/, X-API-Key)
 * and a decoy listener at the address put in `resume_url`, which must never be called.
 *
 * The HireOS server must run against a THROWAWAY database with
 *   RESUME_PARSER_API_URL=http://127.0.0.1:<MOCK_PORT>  RESUME_PARSER_API_KEY=<same key as here>
 *
 *   DATABASE_URL=postgresql://.../hireos_import_test BASE_URL=http://localhost:3002 STORAGE_ROOT=<server's> \
 *     AUTH_SECRET=... RESUME_PARSER_API_KEY=... MOCK_PORT=8099 DECOY_PORT=8098 node tests/isolation/resume-parser.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const KEY = process.env.RESUME_PARSER_API_KEY;
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8099);
const DECOY_PORT = Number(process.env.DECOY_PORT ?? 8098);
if (!STORAGE_ROOT || !KEY) throw new Error("STORAGE_ROOT and RESUME_PARSER_API_KEY are required.");

const db = new PrismaClient({ datasources: { db: { url } } });
const tag = `rp${Date.now()}`;
const results = [];

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

// ---------------------------------------------------------------- mock Resume Parser
const existingEmail = `existing.${tag}@example.test`;
const profiles = [
  { id: 101, name: "Priya Sharma", email: `priya.${tag}@example.test`, file_name: "Priya_Sharma.pdf" },
  { id: 102, name: "Existing Person", email: existingEmail.toUpperCase(), file_name: "existing.pdf" },
  { id: 103, name: "No File", email: `nofile.${tag}@example.test`, file_name: null },
  { id: 104, name: "Old Word", email: `doc.${tag}@example.test`, file_name: "old.doc" },
  { id: 105, name: "", email: "", file_name: "anon.pdf" },
  { id: 106, name: "Ravi Kumar", email: `ravi.${tag}@example.test`, file_name: "Ravi_Kumar.doc" },
  { id: 107, name: "Asha Rao", email: `asha.${tag}@example.test`, file_name: "Asha_Rao.pdf" },
].map((p) => ({
  phone_numbers: "+91 98765 43210",
  location: "Hyderabad",
  region: "TS",
  linkedin: "https://linkedin.com/in/someone",
  total_experience: 6,
  skills: ["Django", "Python", "SQL"],
  matched_skills: ["Python"],
  created_at: "2026-09-14T10:22:31",
  resume_url: `http://127.0.0.1:${DECOY_PORT}/steal/${p.id}/`,
  ...p,
}));
const files = {
  101: { type: "application/pdf", name: "Priya_Sharma.pdf", data: textPdf(["Priya Sharma", `SECRET_TEXT_${tag}`, "Python Django"]) },
  102: { type: "application/pdf", name: "existing.pdf", data: textPdf(["Existing Person"]) },
  104: { type: "application/msword", name: "old.doc", data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) },
  105: { type: "application/pdf", name: "anon.pdf", data: textPdf(["No contact details at all"]) },
  106: { type: "application/msword", name: "Ravi_Kumar.doc", data: readFileSync(join("tests", "fixtures", "resumes", "resume-plain.doc")) },
  107: {
    type: "application/pdf",
    name: "Asha_Rao.pdf",
    data: textPdf(["Asha Rao", "Python developer, 6 years", "Django, SQL, REST APIs", "Built payment services in Python"]),
  },
};
const SCREENING_WAIT_MS = Number(process.env.SCREENING_WAIT_MS ?? 300_000);
const mockLog = [];
let decoyHits = 0;

const mock = createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  mockLog.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), key: req.headers["x-api-key"] });
  if (req.headers["x-api-key"] !== KEY) {
    res.writeHead(403, { "Content-Type": "application/json" }).end('{"detail":"Invalid API key"}');
    return;
  }
  if (u.pathname === "/api/v1/external/profiles/search/") {
    const skills = u.searchParams.get("skills") ?? "";
    if (!skills && !u.searchParams.get("any_skills")) {
      res.writeHead(400).end('{"detail":"skills or any_skills required"}');
      return;
    }
    if (skills.includes("rejectme")) {
      res.writeHead(403).end('{"detail":"Invalid API key"}');
      return;
    }
    if (skills.includes("brokenjson")) {
      res.writeHead(200, { "Content-Type": "text/html" }).end("<html>oops</html>");
      return;
    }
    const page = Number(u.searchParams.get("page") ?? 1);
    const pageSize = Number(u.searchParams.get("page_size") ?? 25);
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({ count: profiles.length, page, page_size: pageSize, total_pages: 1, results: profiles }),
    );
    return;
  }
  const m = /^\/api\/v1\/external\/profiles\/(\d+)\/resume\/$/.exec(u.pathname);
  const file = m ? files[m[1]] : undefined;
  if (!file) {
    res.writeHead(404).end('{"detail":"Not found"}');
    return;
  }
  res.writeHead(200, { "Content-Type": file.type, "Content-Disposition": `attachment; filename="${file.name}"` }).end(file.data);
});
const decoy = createServer((req, res) => {
  decoyHits++;
  res.writeHead(200).end("stolen");
});

// ---------------------------------------------------------------- HireOS helpers
async function call(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
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
const search = (cookie, qs) => call(cookie, "GET", `/api/talent/resume-parser/search?${qs}`);
const addRaw = (cookie, body) => call(cookie, "POST", "/api/talent/resume-parser/add", body);
/** Adds to the caller's own open job unless the body names a job. */
const add = (cookie, body) =>
  addRaw(
    cookie,
    body && typeof body === "object" && !("jobId" in body)
      ? { ...body, jobId: cookie === cookies.recruiterB ? jobs.openB.id : jobs.openA.id }
      : body,
  );

let orgA;
let orgB;
const users = {};
const cookies = {};
let existingId;
const jobs = {};

async function seed() {
  orgA = await db.organization.create({ data: { name: `RP A ${tag}`, slug: `${tag}-a` } });
  orgB = await db.organization.create({ data: { name: `RP B ${tag}`, slug: `${tag}-b` } });
  const mk = async (key, role, organizationId) => {
    users[key] = await db.user.create({
      data: { email: `${key}.${tag}@example.test`, passwordHash: "x", name: key, role, organizationId, isActive: true },
    });
    cookies[key] = await mintCookie(users[key]);
  };
  await mk("recruiter", "RECRUITER", orgA.id);
  await mk("hr", "HR_ADMIN", orgA.id);
  await mk("manager", "HIRING_MANAGER", orgA.id);
  await mk("interviewer", "INTERVIEWER", orgA.id);
  await mk("recruiterB", "RECRUITER", orgB.id);
  existingId = (
    await db.candidate.create({
      data: { organizationId: orgA.id, email: existingEmail, firstName: "Existing", lastName: "Person", phone: "111", skills: ["Kept"] },
    })
  ).id;
  const job = async (key, organizationId, status, createdById) => {
    jobs[key] = await db.job.create({
      data: {
        organizationId,
        title: `Python Developer ${key}`,
        description: "Build backend services in Python and Django.",
        skills: ["Python", "Django"],
        experienceMin: 3,
        status,
        createdById,
      },
    });
  };
  await job("openA", orgA.id, "OPEN", users.recruiter.id);
  await job("closedA", orgA.id, "CLOSED", users.recruiter.id);
  await job("openB", orgB.id, "OPEN", users.recruiterB.id);
}

async function cleanup() {
  const cands = await db.candidate.findMany({
    where: { organizationId: { in: [orgA?.id, orgB?.id].filter(Boolean) } },
    select: { resumeUrl: true },
  });
  for (const c of cands) if (c.resumeUrl) await rm(join(STORAGE_ROOT, c.resumeUrl), { force: true });
  await db.candidate.deleteMany({ where: { organizationId: { in: [orgA?.id, orgB?.id].filter(Boolean) } } });
  await db.job.deleteMany({ where: { organizationId: { in: [orgA?.id, orgB?.id].filter(Boolean) } } });
  await db.user.deleteMany({ where: { email: { endsWith: `.${tag}@example.test` } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA?.id, orgB?.id].filter(Boolean) } } });
}

const QS = "skills=python,django&anySkills=flask,fastapi&excludeSkills=php&minExperience=3&maxExperience=10&city=hyd&state=TS&page=1&pageSize=25";
const ITEM_KEYS = ["addedAt", "candidateId", "email", "experience", "fileName", "id", "location", "matchedSkills", "name", "skills"];

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  await new Promise((r) => decoy.listen(DECOY_PORT, "127.0.0.1", r));
  await seed();
  try {
    await check("unauthenticated search and add are 401", async () => {
      assert.equal((await search(null, QS)).res.status, 401);
      assert.equal((await add(null, { profileId: 101 })).res.status, 401);
    });

    await check("interviewer and hiring manager are 403 for search and add", async () => {
      for (const who of ["interviewer", "manager"]) {
        assert.equal((await search(cookies[who], QS)).res.status, 403, `${who} search`);
        assert.equal((await add(cookies[who], { profileId: 101 })).res.status, 403, `${who} add`);
      }
    });

    await check("invalid search input is 400 and never reaches Resume Parser", async () => {
      const before = mockLog.length;
      for (const qs of ["city=x", "skills=a&minExperience=9&maxExperience=2", "skills=a&pageSize=500", `skills=${"x".repeat(61)}`, "skills=a&page=0", "skills=a&minExperience=abc"]) {
        assert.equal((await search(cookies.recruiter, qs)).res.status, 400, qs);
      }
      assert.equal(mockLog.length, before);
    });

    await check("recruiter search: documented query + key sent; only list fields returned; existing candidate linked", async () => {
      const { res, json } = await search(cookies.recruiter, QS);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const last = mockLog.at(-1);
      assert.equal(last.path, "/api/v1/external/profiles/search/");
      assert.equal(last.key, KEY);
      assert.deepEqual(last.query, {
        skills: "python,django",
        any_skills: "flask,fastapi",
        exclude_skills: "php",
        min_experience: "3",
        max_experience: "10",
        city: "hyd",
        state: "TS",
        page: "1",
        page_size: "25",
      });
      assert.equal(json.total, 7);
      for (const item of json.items) assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS);
      assert.equal(JSON.stringify(json).includes("98765"), false, "phone leaked");
      assert.equal(JSON.stringify(json).includes("steal"), false, "resume_url leaked");
      assert.equal(json.items.find((i) => i.id === 102).candidateId, existingId);
      assert.equal(json.items.find((i) => i.id === 101).candidateId, null);
      assert.equal(json.items.find((i) => i.id === 101).location, "Hyderabad, TS");
    });

    await check("Resume Parser key rejection and bad responses give safe 502 messages", async () => {
      for (const skill of ["rejectme", "brokenjson"]) {
        const { res, text } = await search(cookies.recruiter, `skills=${skill}`);
        assert.equal(res.status, 502, skill);
        assert.equal(text.includes(KEY), false);
        assert.equal(text.includes(String(MOCK_PORT)), false);
        assert.equal(text.includes("127.0.0.1"), false);
      }
    });

    await check("add input validation is 400", async () => {
      for (const body of [{}, { profileId: "101" }, { profileId: -1 }, { profileId: 1.5 }, { profileId: 101, email: "x@y.z" }, "not json"]) {
        assert.equal((await add(cookies.recruiter, body)).res.status, 400, JSON.stringify(body));
      }
    });

    await check("adding without a job is refused (no Talent-Pool-only add) and stores nothing", async () => {
      const count = await db.candidate.count({ where: { organizationId: orgA.id } });
      const r = await addRaw(cookies.recruiter, { profileId: 101 });
      assert.equal(r.res.status, 400);
      assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), count);
    });

    await check("another organization cannot add a profile only org A searched; unknown ids are 404", async () => {
      const r1 = await add(cookies.recruiterB, { profileId: 101 });
      assert.equal(r1.res.status, 404);
      assert.equal(await db.candidate.count({ where: { organizationId: orgB.id } }), 0);
      assert.equal((await add(cookies.recruiter, { profileId: 999 })).res.status, 404);
    });

    let priyaId;
    await check("add creates the candidate in the caller's org from the downloaded resume, in the chosen job", async () => {
      const downloadsBefore = mockLog.filter((l) => l.path.endsWith("/resume/")).length;
      const { res, json, text } = await add(cookies.recruiter, { profileId: 101 });
      assert.equal(res.status, 201, text);
      assert.equal(json.status, "created");
      assert.equal(json.job, "added");
      assert.deepEqual(Object.keys(json).sort(), ["applicationId", "candidateId", "job", "jobTitle", "parsed", "screening", "status"]);
      priyaId = json.candidateId;
      const c = await db.candidate.findUniqueOrThrow({ where: { id: priyaId }, include: { applications: true, notes: true } });
      assert.equal(c.organizationId, orgA.id);
      assert.equal(c.email, `priya.${tag}@example.test`);
      assert.deepEqual([c.firstName, c.lastName], ["Priya", "Sharma"]);
      assert.deepEqual(c.skills, ["Django", "Python", "SQL"]);
      assert.equal(c.location, "Hyderabad, TS");
      assert.equal(c.experience, 6);
      assert.ok(c.resumeText?.includes(`SECRET_TEXT_${tag}`));
      assert.equal(/--\s*\d+\s+of\s+\d+\s*--/.test(c.resumeText ?? ""), false, "page marker stored");
      assert.equal(c.applications.length, 1);
      assert.deepEqual([c.applications[0].jobId, c.applications[0].stage, c.applications[0].status], [jobs.openA.id, "APPLIED", "ACTIVE"]);
      assert.equal(c.notes.length, 1);
      assert.equal(c.notes[0].authorId, users.recruiter.id);
      await stat(join(STORAGE_ROOT, c.resumeUrl));
      const downloads = mockLog.filter((l) => l.path.endsWith("/resume/"));
      assert.equal(downloads.length, downloadsBefore + 1);
      assert.equal(downloads.at(-1).path, "/api/v1/external/profiles/101/resume/");
      assert.equal(downloads.at(-1).key, KEY);
    });

    await check("the decoy address in resume_url was never called", async () => {
      assert.equal(decoyHits, 0);
    });

    await check("adding again is 'already in job'; an existing email is added to the job unchanged, no screening without text", async () => {
      const again = await add(cookies.recruiter, { profileId: 101 });
      assert.equal(again.res.status, 200);
      assert.deepEqual(again.json, { status: "exists", candidateId: priyaId, jobTitle: jobs.openA.title, job: "already_in_job" });
      assert.equal(await db.application.count({ where: { candidateId: priyaId } }), 1);
      const before = await db.candidate.findUniqueOrThrow({ where: { id: existingId } });
      const ex = await add(cookies.hr, { profileId: 102 });
      assert.equal(ex.res.status, 201, ex.text);
      assert.equal(ex.json.status, "exists");
      assert.equal(ex.json.candidateId, existingId);
      assert.equal(ex.json.screening, "no_resume_text");
      assert.deepEqual(await db.candidate.findUniqueOrThrow({ where: { id: existingId } }), before);
      const app = await db.application.findUniqueOrThrow({ where: { id: ex.json.applicationId } });
      assert.deepEqual([app.stage, app.status, app.jobId], ["APPLIED", "ACTIVE", jobs.openA.id]);
    });

    await check("a real old Word (.doc) resume is added and its text read locally", async () => {
      const r = await add(cookies.recruiter, { profileId: 106 });
      assert.equal(r.res.status, 201);
      const c = await db.candidate.findUniqueOrThrow({ where: { id: r.json.candidateId } });
      assert.equal(c.organizationId, orgA.id);
      assert.match(c.resumeText ?? "", /Senior Java Developer/);
      assert.match(c.resumeUrl ?? "", /\.doc$/);
    });

    await check("no file (404), a fake .doc (422) and no email (422) add nothing", async () => {
      const count = await db.candidate.count({ where: { organizationId: orgA.id } });
      assert.equal((await add(cookies.recruiter, { profileId: 103 })).res.status, 404);
      assert.equal((await add(cookies.recruiter, { profileId: 104 })).res.status, 422);
      assert.equal((await add(cookies.recruiter, { profileId: 105 })).res.status, 422);
      assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), count);
    });

    await check("Add to job: bad, closed or other-organization job ids are 400 before any download", async () => {
      const count = await db.candidate.count({ where: { organizationId: orgA.id } });
      const downloads = mockLog.filter((l) => l.path.endsWith("/resume/")).length;
      for (const jobId of [123, "", "x".repeat(65), null]) {
        assert.equal((await add(cookies.recruiter, { profileId: 107, jobId })).res.status, 400, JSON.stringify(jobId));
      }
      for (const jobId of [jobs.closedA.id, jobs.openB.id, "does-not-exist"]) {
        const r = await add(cookies.recruiter, { profileId: 107, jobId });
        assert.equal(r.res.status, 400, jobId);
        assert.equal(r.json.error, "Choose an open job opening.");
      }
      assert.equal(await db.candidate.count({ where: { organizationId: orgA.id } }), count);
      assert.equal(mockLog.filter((l) => l.path.endsWith("/resume/")).length, downloads);
    });

    await check("Add to job: interviewer and hiring manager are 403", async () => {
      for (const who of ["interviewer", "manager"]) {
        assert.equal((await add(cookies[who], { profileId: 107, jobId: jobs.openA.id })).res.status, 403, who);
      }
    });

    let ashaApplicationId;
    await check("Add to job: new profile gets the resume, an Applied application in the job and screening started", async () => {
      const { res, json, text } = await add(cookies.recruiter, { profileId: 107, jobId: jobs.openA.id });
      assert.equal(res.status, 201, text);
      assert.deepEqual(Object.keys(json).sort(), ["applicationId", "candidateId", "job", "jobTitle", "parsed", "screening", "status"]);
      assert.equal(json.status, "created");
      assert.equal(json.job, "added");
      assert.equal(json.jobTitle, jobs.openA.title);
      assert.equal(json.screening, "started");
      ashaApplicationId = json.applicationId;
      const app = await db.application.findUniqueOrThrow({ where: { id: ashaApplicationId }, include: { candidate: true } });
      assert.deepEqual([app.stage, app.status, app.jobId], ["APPLIED", "ACTIVE", jobs.openA.id]);
      assert.equal(app.candidate.organizationId, orgA.id);
      assert.match(app.candidate.resumeText ?? "", /payment services/);
      await stat(join(STORAGE_ROOT, app.candidate.resumeUrl));
    });

    await check("Add to job: the same profile again is 200 'already in job' with no second application", async () => {
      const r = await add(cookies.recruiter, { profileId: 107, jobId: jobs.openA.id });
      assert.equal(r.res.status, 200);
      assert.equal(r.json.job, "already_in_job");
      assert.equal(r.json.applicationId, undefined);
      assert.equal(await db.application.count({ where: { jobId: jobs.openA.id, candidateId: r.json.candidateId } }), 1);
    });

    await check("Add to job: AI screening finishes or records an honest failure; stage and status never change", async () => {
      const deadline = Date.now() + SCREENING_WAIT_MS;
      let outcome = null;
      while (!outcome && Date.now() < deadline) {
        const events = await db.timelineEvent.findMany({ where: { applicationId: ashaApplicationId } });
        if (events.some((e) => e.type === "SCREENING_COMPLETED")) outcome = "completed";
        else if (events.some((e) => e.type === "OTHER" && e.payload?.kind === "ai_screening_failed")) outcome = "failed";
        else await new Promise((r) => setTimeout(r, 3000));
      }
      assert.ok(outcome, `no screening outcome within ${SCREENING_WAIT_MS} ms`);
      const app = await db.application.findUniqueOrThrow({ where: { id: ashaApplicationId }, include: { aiEvaluations: true } });
      assert.deepEqual([app.stage, app.status], ["APPLIED", "ACTIVE"]);
      if (outcome === "completed") {
        assert.equal(app.aiEvaluations.length, 1);
        assert.equal(app.aiEvaluations[0].kind, "RESUME_SCREEN");
        assert.ok(app.aiEvaluations[0].reasoning.trim().length > 0, "reasoning stored");
      } else {
        assert.equal(app.aiEvaluations.length, 0, "a failure stores no AI result");
      }
      console.log(`  (screening outcome: ${outcome})`);
    });

    await check("org B searching for itself gets its own candidate; org A's is untouched", async () => {
      assert.equal((await search(cookies.recruiterB, "skills=python")).res.status, 200);
      const r = await add(cookies.recruiterB, { profileId: 101 });
      assert.equal(r.res.status, 201);
      assert.notEqual(r.json.candidateId, priyaId);
      const b = await db.candidate.findUniqueOrThrow({ where: { id: r.json.candidateId } });
      assert.equal(b.organizationId, orgB.id);
      assert.equal((await db.candidate.findUniqueOrThrow({ where: { id: priyaId } })).organizationId, orgA.id);
    });

    await check("Add to job: org B cannot use org A's job", async () => {
      const r = await add(cookies.recruiterB, { profileId: 101, jobId: jobs.openA.id });
      assert.equal(r.res.status, 400);
      assert.equal(await db.application.count({ where: { jobId: jobs.openA.id, candidate: { organizationId: orgB.id } } }), 0);
    });
  } finally {
    await cleanup();
    await db.$disconnect();
    mock.close();
    decoy.close();
  }

  for (const r of results) console.log(r.join(" | "));
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
