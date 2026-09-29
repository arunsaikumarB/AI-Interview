/**
 * V3.0 practical assessment runtime — application security and lifecycle.
 *
 * Covers: unauthenticated, CANDIDATE / INTERVIEWER denied, wrong organisation,
 * wrong application, malformed ids / tokens, forged fields (hidden tests,
 * limits, competency, expected result), one immutable submission, DB-level
 * immutability trigger, no stage change, no AIEvaluation, audit kinds, and
 * rate limiting.
 *
 * Requires: Postgres seeded, Next.js on BASE_URL, sandbox runner on 127.0.0.1:8010.
 * Temporary users, organisation, job and applications are created and removed here.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { BASE, api, cleanupIsolationPair, mintCookie, prisma, seedIsolationPair } from "./helpers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INTERNALS_RE = /at .*\(|prisma|DATABASE_URL|SANDBOX_RUNNER|stack/i;

describe("Practical assessment runtime isolation", () => {
  /** @type {import('@prisma/client').PrismaClient} */
  let db;
  let pair;
  let otherOrg;
  let job;
  let appX;
  let appY;
  const tempUsers = [];
  let recruiter;
  let recruiterCookie;
  let interviewerCookie;
  let candidateCookie;
  let otherOrgCookie;
  let sqlToken;
  let sqlAssessmentId;
  let codingToken;
  let codingAssessmentId;
  let stageBefore;

  async function tempUser(role, organizationId, tag) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const u = await db.user.create({
      data: {
        email: `iso-practical-${tag}-${stamp}@example.com`,
        name: `Isolation ${tag}`,
        role,
        passwordHash: await bcrypt.hash(`iso-${stamp}`, 10),
        organizationId,
        isActive: true,
      },
    });
    tempUsers.push(u.id);
    return { user: u, cookie: await mintCookie({ id: u.id, email: u.email, name: u.name, role, organizationId }) };
  }

  const cand = (method, token, suffix = "", body) => api("", method, `/api/practical/${token}${suffix}`, body);

  before(async () => {
    const health = await fetch(`${BASE}/api/health`);
    assert.equal(health.ok, true, "App must be reachable (npm run dev / start)");
    const runner = await fetch("http://127.0.0.1:8010/health").catch(() => null);
    assert.ok(runner?.ok, "Sandbox runner must be running (npm run sandbox:runner)");

    db = prisma();
    pair = await seedIsolationPair(db);
    otherOrg = await db.organization.create({ data: { name: "Isolation Other Org", slug: `iso-practical-org-${Date.now()}` } });

    const r = await tempUser("RECRUITER", pair.org.id, "recruiter");
    recruiter = r.user;
    recruiterCookie = r.cookie;
    interviewerCookie = (await tempUser("INTERVIEWER", pair.org.id, "interviewer")).cookie;
    otherOrgCookie = (await tempUser("RECRUITER", otherOrg.id, "other-org")).cookie;
    candidateCookie = await mintCookie({
      id: pair.userA.id,
      email: pair.userA.email,
      name: pair.userA.name,
      role: "CANDIDATE",
      organizationId: pair.userA.organizationId,
    });

    job = await db.job.create({
      data: {
        organizationId: pair.org.id,
        title: "Isolation Data Engineer",
        description:
          "Responsibilities:\n- Write SQL queries against PostgreSQL for analytics\n- Build data pipelines in Python\nRequirements:\n- Strong SQL and Python\n- Data analysis experience",
        skills: ["SQL", "Python", "PostgreSQL"],
        experienceMin: 2,
        experienceMax: 5,
        status: "OPEN",
        createdById: recruiter.id,
      },
    });
    appX = await db.application.create({
      data: { candidateId: pair.candA.id, jobId: job.id, stage: "ASSESSMENT", status: "ACTIVE", source: "isolation_test" },
    });
    appY = await db.application.create({
      data: { candidateId: pair.candB.id, jobId: job.id, stage: "SCREENING", status: "ACTIVE", source: "isolation_test" },
    });
    stageBefore = { stage: appX.stage, status: appX.status };
  });

  after(async () => {
    if (!db) return;
    if (appX || appY) await db.application.deleteMany({ where: { id: { in: [appX?.id, appY?.id].filter(Boolean) } } });
    if (job) await db.job.deleteMany({ where: { id: job.id } });
    await db.user.deleteMany({ where: { id: { in: tempUsers } } });
    if (otherOrg) await db.organization.deleteMany({ where: { id: otherOrg.id } });
    await cleanupIsolationPair(db, pair);
    await db.$disconnect();
  });

  it("unauthenticated staff routes → 401", async () => {
    for (const [method, path] of [
      ["GET", `/api/applications/${appX.id}/practical-assessments`],
      ["POST", `/api/applications/${appX.id}/practical-assessments`],
      ["GET", "/api/practical-assessments/someid"],
      ["POST", "/api/practical-assessments/someid/cancel"],
    ]) {
      const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  it("CANDIDATE and INTERVIEWER cannot assign or view evidence", async () => {
    for (const cookie of [candidateCookie, interviewerCookie]) {
      const list = await api(cookie, "GET", `/api/applications/${appX.id}/practical-assessments`);
      assert.equal(list.res.status, 403);
      const assign = await api(cookie, "POST", `/api/applications/${appX.id}/practical-assessments`, { type: "SQL" });
      assert.equal(assign.res.status, 403);
    }
    assert.equal(await db.practicalAssessment.count({ where: { applicationId: appX.id } }), 0);
  });

  it("malformed ids → 400, unknown application → 404", async () => {
    const bad = await api(recruiterCookie, "POST", `/api/applications/${encodeURIComponent("bad$id<x>")}/practical-assessments`, { type: "SQL" });
    assert.equal(bad.res.status, 400);
    const detail = await api(recruiterCookie, "GET", `/api/practical-assessments/${encodeURIComponent("../../etc")}`);
    assert.equal(detail.res.status, 400);
    const missing = await api(recruiterCookie, "POST", "/api/applications/nonexistentbutwellformed01/practical-assessments", { type: "SQL" });
    assert.equal(missing.res.status, 404);
  });

  it("wrong organisation → 404 without leaking the application", async () => {
    const list = await api(otherOrgCookie, "GET", `/api/applications/${appX.id}/practical-assessments`);
    assert.equal(list.res.status, 404);
    const assign = await api(otherOrgCookie, "POST", `/api/applications/${appX.id}/practical-assessments`, { type: "SQL" });
    assert.equal(assign.res.status, 404);
    assert.ok(!assign.text.includes(job.title));
  });

  it("browser cannot choose competency, difficulty, tests, limits or expected results", async () => {
    for (const body of [
      { type: "SQL", competency: "Anything" },
      { type: "SQL", difficulty: "EASY" },
      { type: "CODING", hiddenTests: [] },
      { type: "CODING", limits: { perTestTimeoutMs: 60000 } },
      { type: "SQL", expectedResult: { columns: [], rows: [] } },
      { type: "SYSTEM_DESIGN" },
      {},
    ]) {
      const { res, text } = await api(recruiterCookie, "POST", `/api/applications/${appX.id}/practical-assessments`, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(!INTERNALS_RE.test(text));
    }
    const res = await fetch(`${BASE}/api/applications/${appX.id}/practical-assessments`, {
      method: "POST",
      headers: { Cookie: recruiterCookie, "Content-Type": "text/plain" },
      body: '{"type":"SQL"}',
    });
    assert.equal(res.status, 415);
    assert.equal(await db.practicalAssessment.count({ where: { applicationId: appX.id } }), 0);
  });

  it("recruiter assigns SQL and CODING; the token is shown once and only its hash is stored", async () => {
    const sql = await api(recruiterCookie, "POST", `/api/applications/${appX.id}/practical-assessments`, { type: "SQL" });
    assert.equal(sql.res.status, 201, sql.text);
    assert.match(sql.json.candidatePath, /^\/practical\/[A-Za-z0-9_-]{43}$/);
    sqlToken = sql.json.candidatePath.split("/").pop();
    sqlAssessmentId = sql.json.assessment.id;
    assert.equal(sql.json.assessment.type, "SQL");
    assert.equal(sql.json.assessment.status, "NOT_STARTED");

    const row = await db.practicalAssessment.findUnique({ where: { id: sqlAssessmentId } });
    assert.equal(row.accessTokenHash, crypto.createHash("sha256").update(sqlToken).digest("hex"));
    assert.ok(!JSON.stringify(row).includes(sqlToken), "raw token is never persisted");
    assert.equal(row.provenance.applicationId, appX.id);
    assert.equal(row.provenance.jobId, job.id);

    const dup = await api(recruiterCookie, "POST", `/api/applications/${appX.id}/practical-assessments`, { type: "SQL" });
    assert.equal(dup.res.status, 409);

    const coding = await api(recruiterCookie, "POST", `/api/applications/${appX.id}/practical-assessments`, { type: "CODING" });
    assert.equal(coding.res.status, 201, coding.text);
    codingToken = coding.json.candidatePath.split("/").pop();
    codingAssessmentId = coding.json.assessment.id;

    const list = await api(recruiterCookie, "GET", `/api/applications/${appX.id}/practical-assessments`);
    assert.equal(list.res.status, 200);
    assert.equal(list.json.assessments.length, 2);
    for (const secret of ["accessTokenHash", sqlToken, codingToken, "draftSource", "hiddenTests", "expectedResult"]) {
      assert.ok(!list.text.includes(secret), `list leaks ${secret}`);
    }
  });

  it("candidate token: malformed → 400, unknown → 404, and a staff session is not a substitute", async () => {
    assert.equal((await cand("GET", "not-a-token")).res.status, 400);
    assert.equal((await cand("GET", "A".repeat(43))).res.status, 404);
    const forged = await cand("POST", "B".repeat(43), "/submit", { language: "postgresql", source: "SELECT 1" });
    assert.equal(forged.res.status, 404);
    const viaId = await api(recruiterCookie, "GET", `/api/practical/${sqlAssessmentId}`);
    assert.equal(viaId.res.status, 400, "assessment id is not a token");
  });

  it("before start the candidate sees no task; after start no hidden data is sent", async () => {
    const pre = await cand("GET", sqlToken);
    assert.equal(pre.res.status, 200);
    assert.equal(pre.json.status, "NOT_STARTED");
    assert.equal(pre.json.task, null);

    const early = await cand("POST", sqlToken, "/run", { language: "postgresql", source: "SELECT 1" });
    assert.equal(early.res.status, 409);

    const started = await cand("POST", sqlToken, "/start", {});
    assert.equal(started.res.status, 200, started.text);
    assert.equal(started.json.status, "STARTED");
    assert.equal(started.json.task.kind, "SQL");
    for (const secret of ["expectedResult", "hiddenTests", "comparison", "datasetKey", "competency", "provenance"]) {
      assert.ok(!started.text.includes(`"${secret}"`), `candidate view leaks ${secret}`);
    }
    assert.equal((await cand("POST", sqlToken, "/start", {})).res.status, 409);
  });

  it("autosave stores drafts only and rejects forged fields or wrong languages", async () => {
    const before = await db.practicalSubmission.count({ where: { assessmentId: sqlAssessmentId } });
    for (const body of [
      { language: "postgresql", source: "SELECT 1", expectedResult: {} },
      { language: "postgresql", source: "SELECT 1", status: "COMPLETED" },
      { language: "python", source: "print(1)" },
    ]) {
      const { res } = await cand("PUT", sqlToken, "/draft", body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const ok = await cand("PUT", sqlToken, "/draft", { language: "postgresql", source: "SELECT city FROM customers" });
    assert.equal(ok.res.status, 200, ok.text);
    const row = await db.practicalAssessment.findUnique({ where: { id: sqlAssessmentId } });
    assert.equal(row.status, "IN_PROGRESS");
    assert.equal(row.draftSource, "SELECT city FROM customers");
    assert.equal(await db.practicalSubmission.count({ where: { assessmentId: sqlAssessmentId } }), before, "autosave never submits");
  });

  it("Run Query executes in the sandbox, returns a table only, and cannot modify data", async () => {
    const ok = await cand("POST", sqlToken, "/run", { language: "postgresql", source: "SELECT count(*) AS n FROM customers" });
    assert.equal(ok.res.status, 200, ok.text);
    assert.equal(ok.json.status, "OK");
    assert.deepEqual(ok.json.columns, ["n"]);
    assert.equal(String(ok.json.rows[0][0]), "13");
    for (const leak of ["correct", "mismatch", "expected", "passed"]) assert.ok(!ok.text.includes(`"${leak}"`), `run leaks ${leak}`);

    const drop = await cand("POST", sqlToken, "/run", { language: "postgresql", source: "DROP TABLE customers" });
    assert.equal(drop.res.status, 200);
    assert.equal(drop.json.status, "SQL_ERROR");
    const multi = await cand("POST", sqlToken, "/run", { language: "postgresql", source: "SELECT 1; DELETE FROM customers" });
    assert.equal(multi.json.status, "SQL_ERROR");
    const still = await cand("POST", sqlToken, "/run", { language: "postgresql", source: "SELECT count(*) FROM customers" });
    assert.equal(String(still.json.rows[0][0]), "13");

    const forged = await cand("POST", sqlToken, "/run", { language: "postgresql", source: "SELECT 1", limits: { timeoutMs: 999999 } });
    assert.equal(forged.res.status, 400);
  });

  it("submission is frozen once, executed server-side, and the candidate never receives a result", async () => {
    const source = "SELECT city, count(*) AS n FROM customers WHERE city IS NOT NULL GROUP BY city ORDER BY n DESC, city";
    const sub = await cand("POST", sqlToken, "/submit", { language: "postgresql", source });
    assert.equal(sub.res.status, 202, sub.text);
    const sha = crypto.createHash("sha256").update(source).digest("hex");
    assert.equal(sub.json.sourceSha256, sha);

    const again = await cand("POST", sqlToken, "/submit", { language: "postgresql", source: "SELECT 2" });
    assert.equal(again.res.status, 409);
    assert.equal((await cand("PUT", sqlToken, "/draft", { language: "postgresql", source: "x" })).res.status, 409);
    assert.equal((await cand("POST", sqlToken, "/run", { language: "postgresql", source: "SELECT 1" })).res.status, 409);

    let detail;
    for (let i = 0; i < 40; i++) {
      detail = await api(recruiterCookie, "GET", `/api/practical-assessments/${sqlAssessmentId}`);
      if (["COMPLETED", "EXECUTION_FAILED", "TIMEOUT"].includes(detail.json?.status)) break;
      await sleep(500);
    }
    assert.equal(detail.res.status, 200);
    assert.equal(detail.json.status, "COMPLETED", detail.text);
    assert.equal(detail.json.submission.source, source);
    assert.equal(detail.json.submission.sourceSha256, sha);
    assert.equal(detail.json.submission.execStatus, "COMPLETED");
    assert.equal(detail.json.submission.result.total, 1);
    assert.equal(typeof detail.json.submission.result.correct, "boolean");
    // provenance.recommendation is the V1 blueprint's practical exercise type, not a hiring verdict.
    assert.ok(!/"(score|scores|overall|hire|reject|verdict|recommendedAction|decision)"\s*:/i.test(detail.text), "no verdict fields");
    assert.equal(typeof detail.json.provenance.recommendation?.type, "string");
    assert.equal(await db.practicalSubmission.count({ where: { assessmentId: sqlAssessmentId } }), 1);

    const view = await cand("GET", sqlToken);
    assert.equal(view.json.status, "COMPLETED");
    assert.equal(view.json.task, null);
    for (const leak of ["correct", "passed", "result", "mismatch", "source"]) assert.ok(!view.text.includes(`"${leak}"`), `candidate sees ${leak}`);
  });

  it("the database refuses to alter a frozen submission or rewrite a final result", async () => {
    const sub = await db.practicalSubmission.findUnique({ where: { assessmentId: sqlAssessmentId } });
    await assert.rejects(db.practicalSubmission.update({ where: { id: sub.id }, data: { source: "SELECT 'tampered'" } }));
    await assert.rejects(db.practicalSubmission.update({ where: { id: sub.id }, data: { result: { passed: 1, total: 1, correct: true } } }));
    const fresh = await db.practicalSubmission.findUnique({ where: { id: sub.id } });
    assert.equal(fresh.source, sub.source);
    assert.deepEqual(fresh.result, sub.result);
  });

  it("wrong organisation and interviewer cannot read the evidence", async () => {
    assert.equal((await api(otherOrgCookie, "GET", `/api/practical-assessments/${sqlAssessmentId}`)).res.status, 404);
    assert.equal((await api(interviewerCookie, "GET", `/api/practical-assessments/${sqlAssessmentId}`)).res.status, 403);
    assert.equal((await api(candidateCookie, "GET", `/api/practical-assessments/${sqlAssessmentId}`)).res.status, 403);
    assert.equal((await api(otherOrgCookie, "POST", `/api/practical-assessments/${codingAssessmentId}/cancel`)).res.status, 404);
  });

  it("wrong application: another application's list never includes these assessments", async () => {
    const other = await api(recruiterCookie, "GET", `/api/applications/${appY.id}/practical-assessments`);
    assert.equal(other.res.status, 200);
    assert.equal(other.json.assessments.length, 0);
  });

  it("Run Code runs visible tests only", async () => {
    await cand("POST", codingToken, "/start", {});
    const state = await cand("GET", codingToken);
    assert.equal(state.json.task.kind, "CODING");
    const visible = state.json.task.examples.length;
    const run = await cand("POST", codingToken, "/run", { language: "python", source: "import sys\nprint(sys.stdin.read().strip())" });
    assert.equal(run.res.status, 200, run.text);
    assert.equal(run.json.total, visible, "hidden tests are never run by Run Code");
    assert.equal(run.json.tests.length, visible);
    const bash = await cand("POST", codingToken, "/run", { language: "bash", source: "ls /" });
    assert.equal(bash.res.status, 400);
  });

  it("staff can cancel an unsubmitted assessment; the candidate is then locked out", async () => {
    const res = await api(recruiterCookie, "POST", `/api/practical-assessments/${codingAssessmentId}/cancel`);
    assert.equal(res.res.status, 200);
    assert.equal((await api(recruiterCookie, "POST", `/api/practical-assessments/${codingAssessmentId}/cancel`)).res.status, 409);
    assert.equal((await api(recruiterCookie, "POST", `/api/practical-assessments/${sqlAssessmentId}/cancel`)).res.status, 409, "submitted work cannot be cancelled");
    const run = await cand("POST", codingToken, "/run", { language: "python", source: "print(1)" });
    assert.equal(run.res.status, 409);
    assert.equal((await cand("GET", codingToken)).json.status, "CANCELLED");
  });

  it("no stage change, no AIEvaluation, and only practical audit events", async () => {
    const app = await db.application.findUnique({ where: { id: appX.id }, select: { stage: true, status: true } });
    assert.deepEqual(app, stageBefore);
    assert.equal(await db.aIEvaluation.count({ where: { applicationId: appX.id } }), 0);
    const events = await db.timelineEvent.findMany({ where: { applicationId: appX.id }, orderBy: { createdAt: "asc" } });
    assert.ok(events.length >= 5);
    for (const e of events) {
      assert.equal(e.type, "OTHER");
      assert.match(e.payload.kind, /^practical_assessment_/);
      assert.equal(e.payload.advisoryOnly, true);
      assert.equal(e.payload.noAtsStageChange, true);
      assert.ok(!JSON.stringify(e.payload).includes("SELECT"), "audit never contains source");
    }
    const kinds = events.map((e) => e.payload.kind);
    for (const k of ["assigned", "started", "submitted", "completed", "cancelled"]) {
      assert.ok(kinds.includes(`practical_assessment_${k}`), k);
    }
  });

  it("Run / Submit are rate limited per assessment", async () => {
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const { res } = await cand("POST", sqlToken, "/run", {});
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    assert.ok(limited, "run endpoint returns 429 after the per-assessment budget");
    let submitLimited = false;
    for (let i = 0; i < 7; i++) {
      const { res } = await cand("POST", sqlToken, "/submit", {});
      if (res.status === 429) {
        submitLimited = true;
        break;
      }
    }
    assert.ok(submitLimited, "submit endpoint returns 429 after the per-assessment budget");
  });
});
