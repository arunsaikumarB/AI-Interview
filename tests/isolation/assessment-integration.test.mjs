/**
 * V3.1 assessment integration — staff assessment view, candidate hub link,
 * blueprint-driven AI interview, derived practical links, status, evidence,
 * completion audit, RBAC and tenant isolation.
 *
 * Requires: Postgres seeded, Next.js on BASE_URL, sandbox runner on 127.0.0.1:8010.
 * Temporary users, organisation, job and applications are created and removed here.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { BASE, api, assertNoScoreLeak, cleanupIsolationPair, mintCookie, prisma, seedIsolationPair } from "./helpers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INTERNALS_RE = /at .*\(|prisma|DATABASE_URL|SANDBOX_RUNNER|stack/i;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

describe("Assessment integration isolation (V3.1)", () => {
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
  let hubToken;
  let interviewId;
  let interviewToken;
  let sqlToken;
  let sqlId;
  let codingId;
  let stageBefore;

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
    return { user: u, cookie: await mintCookie({ id: u.id, email: u.email, name: u.name, role, organizationId }) };
  }

  const staff = (method, suffix = "", body, cookie = recruiterCookie, appId = appX.id) =>
    api(cookie, method, `/api/applications/${appId}${suffix}`, body);
  const hub = (token) => api("", "GET", `/api/assessment/${token}`);

  before(async () => {
    const health = await fetch(`${BASE}/api/health`);
    assert.equal(health.ok, true, "App must be reachable (npm run dev / start)");
    const runner = await fetch("http://127.0.0.1:8010/health").catch(() => null);
    assert.ok(runner?.ok, "Sandbox runner must be running (npm run sandbox:runner)");

    db = prisma();
    pair = await seedIsolationPair(db);
    otherOrg = await db.organization.create({ data: { name: "Isolation Other Org", slug: `iso-assess-org-${Date.now()}` } });

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
        title: "Isolation Assessment Data Analyst",
        description:
          "Responsibilities:\n- Write SQL queries for reporting and analytics\n- Python scripting for data cleaning\nRequirements:\n- Strong SQL\n- Data analysis experience",
        skills: ["SQL", "Excel", "Python"],
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

  it("1. unauthenticated → 401 on every staff assessment route", async () => {
    for (const [method, suffix] of [
      ["GET", "/assessment"],
      ["POST", "/assessment/link"],
      ["DELETE", "/assessment/link"],
    ]) {
      const res = await fetch(`${BASE}/api/applications/${appX.id}${suffix}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(res.status, 401, `${method} ${suffix}`);
    }
  });

  it("2. CANDIDATE and INTERVIEWER → 403; nothing is created", async () => {
    for (const cookie of [candidateCookie, interviewerCookie]) {
      assert.equal((await staff("GET", "/assessment", undefined, cookie)).res.status, 403);
      assert.equal((await staff("POST", "/assessment/link", {}, cookie)).res.status, 403);
      assert.equal((await staff("DELETE", "/assessment/link", undefined, cookie)).res.status, 403);
      assert.equal((await staff("POST", "/interviews", { source: "BLUEPRINT" }, cookie)).res.status, 403);
    }
    assert.equal(await db.candidateAssessmentLink.count({ where: { applicationId: appX.id } }), 0);
    assert.equal(await db.interviewSession.count({ where: { applicationId: appX.id } }), 0);
  });

  it("3. malformed id → 400, unknown application → 404, wrong organisation → 404 without leaking", async () => {
    assert.equal((await api(recruiterCookie, "GET", `/api/applications/${encodeURIComponent("bad$id<x>")}/assessment`)).res.status, 400);
    assert.equal((await api(recruiterCookie, "POST", `/api/applications/${encodeURIComponent("../../x")}/assessment/link`, {})).res.status, 400);
    assert.equal((await api(recruiterCookie, "GET", "/api/applications/nonexistentbutwellformed01/assessment")).res.status, 404);
    for (const [method, suffix, body] of [
      ["GET", "/assessment", undefined],
      ["POST", "/assessment/link", {}],
      ["DELETE", "/assessment/link", undefined],
    ]) {
      const { res, text } = await staff(method, suffix, body, otherOrgCookie);
      assert.equal(res.status, 404, `${method} ${suffix}`);
      assert.ok(!text.includes(job.title) && !INTERNALS_RE.test(text));
    }
    assert.equal(await db.candidateAssessmentLink.count({ where: { applicationId: appX.id } }), 0);
  });

  it("4. initial staff view: blueprint present, nothing assigned, NOT_STARTED, advisory note, no prompts or scores", async () => {
    const { res, json, text } = await staff("GET", "/assessment");
    assert.equal(res.status, 200, text);
    const a = json.assessment;
    assert.equal(a.application.id, appX.id);
    assert.ok(a.blueprint.competencies.length > 0);
    assert.equal(a.overall, "NOT_STARTED");
    assert.deepEqual(a.components.map((c) => [c.key, c.state]), [
      ["AI_INTERVIEW", "NOT_ASSIGNED"],
      ["CODING", "NOT_ASSIGNED"],
      ["SQL", "NOT_ASSIGNED"],
    ]);
    assert.equal(a.note, "Objective assessment evidence only. Not a hiring recommendation.");
    assert.equal(a.capabilities.createInterview.allowed, true);
    assert.equal(a.capabilities.assignSql.allowed, true);
    assert.ok(!/untrusted_data|system prompt|QUESTION_SYSTEM_PROMPT/i.test(text), "no AI prompts");
    assert.ok(!/"(score|overallScore|recommendation|decision|verdict)"\s*:/i.test(text), "no scores or decisions");
    assert.ok(!text.includes("accessTokenHash"));
  });

  it("5. hub link: forged body → 400, wrong content type rejected, token returned once and only its hash stored", async () => {
    for (const body of [{ candidateId: pair.candB.id }, { applicationId: appY.id }, { expiresAt: "2099-01-01" }, []]) {
      const { res } = await staff("POST", "/assessment/link", body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const plain = await fetch(`${BASE}/api/applications/${appX.id}/assessment/link`, {
      method: "POST",
      headers: { Cookie: recruiterCookie, "Content-Type": "text/plain" },
      body: "{}",
    });
    assert.ok([400, 415].includes(plain.status));
    assert.equal(await db.candidateAssessmentLink.count({ where: { applicationId: appX.id } }), 0);

    const { res, json } = await staff("POST", "/assessment/link", {});
    assert.equal(res.status, 201);
    assert.match(json.candidatePath, /^\/assessment\/[A-Za-z0-9_-]{43}$/);
    assert.equal(json.rotated, false);
    hubToken = json.candidatePath.split("/").pop();
    const row = await db.candidateAssessmentLink.findUnique({ where: { applicationId: appX.id } });
    assert.equal(row.accessTokenHash, sha256(hubToken));
    assert.ok(!JSON.stringify(row).includes(hubToken));
    const view = await staff("GET", "/assessment");
    assert.equal(view.json.assessment.hubLink.status, "ACTIVE");
    assert.ok(!view.text.includes(hubToken), "staff view never re-exposes the token");
  });

  it("6. hub token: malformed → 400, unknown → 404, valid → empty assessment with no internals", async () => {
    assert.equal((await hub("not-a-token")).res.status, 400);
    assert.equal((await hub("A".repeat(43))).res.status, 404);
    const { res, json, text } = await hub(hubToken);
    assert.equal(res.status, 200, text);
    assert.equal(json.hub.jobTitle, job.title);
    assert.deepEqual(json.hub.components, []);
    assert.deepEqual(json.hub.progress, { completed: 0, total: 0 });
    assertNoScoreLeak("hub", text);
  });

  it("7. blueprint interview: server-built validated questions in plan.assessment; duplicate → 409; forged fields ignored", async () => {
    const { res, json, text } = await staff("POST", "/interviews", {
      source: "BLUEPRINT",
      maxQuestions: 3,
      plan: { topics: [{ name: "Injected" }] },
      assessment: { questions: [{ text: "Injected question" }] },
    });
    assert.equal(res.status, 201, text);
    interviewId = json.interview.id;
    interviewToken = json.interview.accessToken;
    const row = await db.interviewSession.findUnique({ where: { id: interviewId } });
    const block = row.plan.assessment;
    assert.equal(block.source, "ASSESSMENT_BLUEPRINT");
    assert.equal(block.applicationId, appX.id);
    assert.equal(block.jobId, job.id);
    assert.ok(block.questions.length > 0);
    assert.ok(block.questions.every((q) => q.type !== "PRACTICAL_RECOMMENDATION" && q.competencyId && q.rubric.length >= 2 && q.expectedEvidence.length >= 1));
    assert.ok(!JSON.stringify(row.plan).includes("Injected"));
    assert.ok(row.maxQuestions >= block.questions.length, "budget covers every validated question");
    assert.equal(row.plan.openingQuestion.question, block.questions[0].text);
    assert.equal(row.status, "SCHEDULED");

    const dup = await staff("POST", "/interviews", { source: "BLUEPRINT" });
    assert.equal(dup.res.status, 409);

    const scheduled = await db.timelineEvent.findFirst({ where: { applicationId: appX.id, type: "INTERVIEW_SCHEDULED" } });
    assert.equal(scheduled.payload.assessmentBlueprint, true);
    assert.equal(scheduled.payload.assessmentQuestionCount, block.questions.length);
  });

  it("8. staff plan edits cannot drop or replace the validated question set", async () => {
    const before = (await db.interviewSession.findUnique({ where: { id: interviewId } })).plan;
    const { assessment: _a, ...editable } = before;
    const edit = await api(recruiterCookie, "PATCH", `/api/interviews/${interviewId}/plan`, {
      ...editable,
      assessment: { ...before.assessment, questions: [{ ...before.assessment.questions[0], text: "Forged replacement question text here" }] },
    });
    assert.equal(edit.res.status, 200, edit.text);
    const after = (await db.interviewSession.findUnique({ where: { id: interviewId } })).plan;
    assert.deepEqual(after.assessment.questions.map((q) => q.id), before.assessment.questions.map((q) => q.id));
    assert.ok(!JSON.stringify(after).includes("Forged replacement"));
  });

  it("9. practical links assigned now are launchable from the hub (derived) and match the returned link", async () => {
    const sql = await staff("POST", "/practical-assessments", { type: "SQL" });
    assert.equal(sql.res.status, 201, sql.text);
    sqlToken = sql.json.candidatePath.split("/").pop();
    sqlId = sql.json.assessment.id;
    const coding = await staff("POST", "/practical-assessments", { type: "CODING" });
    assert.equal(coding.res.status, 201, coding.text);
    codingId = coding.json.assessment.id;

    const { json, text } = await hub(hubToken);
    const byKey = Object.fromEntries(json.hub.components.map((c) => [c.key, c]));
    assert.deepEqual(Object.keys(byKey).sort(), ["AI_INTERVIEW", "CODING", "SQL"]);
    assert.equal(byKey.AI_INTERVIEW.required, true);
    assert.equal(byKey.AI_INTERVIEW.action.href, `/interview/${interviewToken}`);
    assert.equal(byKey.SQL.action.href, `/practical/${sqlToken}`);
    assert.equal(byKey.SQL.status, "Not Started");
    assert.equal(json.hub.progress.total, 3);

    const staffView = await staff("GET", "/assessment");
    const req = Object.fromEntries(staffView.json.assessment.components.map((c) => [c.key, c.required]));
    assert.equal(byKey.SQL.required, req.SQL);
    assert.equal(byKey.CODING.required, req.CODING);
    const recommended = staffView.json.assessment.blueprint.recommendedPractical.type;
    assert.equal(recommended, "SQL_ANALYSIS", "fixture: analyst blueprint recommends SQL");
    assert.equal(req.SQL, recommended === "SQL_ANALYSIS", "SQL required only when the blueprint recommends it");
    assert.equal(req.CODING, recommended === "CODING_EXERCISE", "coding required only when the blueprint recommends it");

    for (const leak of [appX.id, pair.candA.id, interviewId, sqlId, codingId, "rubric", "expectedEvidence", "competency", "accessTokenHash", "provenance", "hiddenTests", "plan", "prompt"]) {
      assert.ok(!text.includes(leak), `hub leaks ${leak}`);
    }
    assertNoScoreLeak("hub", text);
  });

  it("10. the real interview start asks the validated opening question", async () => {
    const started = await api("", "POST", `/api/interview/${interviewToken}/start`, {});
    assert.equal(started.res.status, 200, started.text);
    const plan = (await db.interviewSession.findUnique({ where: { id: interviewId } })).plan;
    assert.ok(plan.assessment, "block survives the start re-save");
    assert.equal(started.json.question.question, plan.assessment.questions[0].text);
    const { json } = await hub(hubToken);
    const iv = json.hub.components.find((c) => c.key === "AI_INTERVIEW");
    assert.equal(iv.status, "In Progress");
    assert.equal(iv.action.kind, "CONTINUE");
  });

  it("11. interview traceability: question → validated slot → answer → competency", async () => {
    const q = await db.interviewQuestion.findFirst({ where: { sessionId: interviewId, sequence: 1 } });
    await db.interviewAnswer.create({ data: { sessionId: interviewId, questionId: q.id, answerText: "Isolation fixture answer about SQL window functions." } });
    const { json } = await staff("GET", "/assessment");
    const a = json.assessment;
    const plan = (await db.interviewSession.findUnique({ where: { id: interviewId } })).plan;
    const slot = plan.assessment.questions[0];
    assert.equal(a.interview.blueprintLinked, true);
    const sq = a.interview.questions.find((x) => x.id === q.id);
    assert.equal(sq.blueprint.id, slot.id);
    assert.equal(sq.answer.text, "Isolation fixture answer about SQL window functions.");
    const entry = a.evidence.find((e) => e.competencyId === slot.competencyId);
    const item = entry.items.find((i) => i.sourceType === "INTERVIEW");
    assert.equal(item.sourceId, q.id);
    assert.equal(item.sessionId, interviewId);
    assert.equal(item.result.assessmentQuestionId, slot.id);
    assert.equal(item.result.answered, true);
    assert.equal(a.interview.notAsked.length, plan.assessment.questions.length - 1);
  });

  it("12. SQL result appears exactly as V3 recorded it; hub shows no result", async () => {
    assert.equal((await api("", "POST", `/api/practical/${sqlToken}/start`, {})).res.status, 200);
    // Distinct from the V3 test's query: the runner's replay cache rejects byte-identical requests signed in the same second.
    const source = "SELECT city, count(*) AS customers_in_city FROM customers WHERE city IS NOT NULL GROUP BY city ORDER BY 2 DESC, 1";
    const sub = await api("", "POST", `/api/practical/${sqlToken}/submit`, { language: "postgresql", source });
    assert.equal(sub.res.status, 202, sub.text);
    let status;
    for (let i = 0; i < 40; i++) {
      status = (await db.practicalAssessment.findUnique({ where: { id: sqlId } })).status;
      if (["COMPLETED", "EXECUTION_FAILED", "TIMEOUT"].includes(status)) break;
      await sleep(500);
    }
    assert.equal(status, "COMPLETED");
    const stored = (await db.practicalSubmission.findUnique({ where: { assessmentId: sqlId } })).result;

    const { json } = await staff("GET", "/assessment");
    const p = json.assessment.practicals.find((x) => x.id === sqlId);
    assert.equal(p.state, "COMPLETED");
    for (const k of ["passed", "total", "correct", "runtimeMs", "rowCount", "mismatch", "timedOut"]) {
      assert.deepEqual(p.result[k], stored[k] ?? null, k);
    }
    const item = json.assessment.evidence.flatMap((e) => e.items).find((i) => i.sourceId === sqlId);
    assert.equal(item.sourceType, "SQL");
    assert.ok(item.submissionId);
    assert.equal(item.result.correct, stored.correct);

    const h = await hub(hubToken);
    const sqlView = h.json.hub.components.find((c) => c.key === "SQL");
    assert.equal(sqlView.status, "Completed");
    assert.equal(sqlView.action, null, "completed components are not restartable");
    for (const leak of ["correct", "passed", "mismatch", "rowCount", "SELECT"]) assert.ok(!h.text.includes(leak), `hub leaks ${leak}`);
  });

  it("13. cancelled components disappear from the hub and progress", async () => {
    assert.equal((await api(recruiterCookie, "POST", `/api/practical-assessments/${codingId}/cancel`)).res.status, 200);
    const { json } = await hub(hubToken);
    assert.ok(!json.hub.components.some((c) => c.key === "CODING"));
    assert.equal(json.hub.progress.total, 2);
    assert.equal(json.hub.progress.completed, 1);
    assert.notEqual(json.hub.assessmentStatus, "COMPLETED");
  });

  it("14. completion only when all required components complete; audited exactly once under concurrency", async () => {
    const pending = await staff("GET", "/assessment");
    assert.equal(pending.json.assessment.overall, "IN_PROGRESS", "required interview still open");
    assert.equal(
      (await db.timelineEvent.count({ where: { applicationId: appX.id, payload: { path: ["kind"], equals: "assessment_completed" } } })),
      0,
    );
    await db.interviewSession.update({ where: { id: interviewId }, data: { status: "COMPLETED", endedAt: new Date() } });
    const results = await Promise.all([staff("GET", "/assessment"), staff("GET", "/assessment"), hub(hubToken), hub(hubToken)]);
    for (const r of results) assert.equal(r.res.status, 200);
    assert.equal(results[0].json.assessment.overall, "COMPLETED");
    assert.equal(results[2].json.hub.assessmentStatus, "COMPLETED");
    await staff("GET", "/assessment");
    const events = await db.timelineEvent.findMany({ where: { applicationId: appX.id, type: "OTHER" } });
    const completed = events.filter((e) => e.payload?.kind === "assessment_completed");
    assert.equal(completed.length, 1);
    const p = completed[0].payload;
    assert.equal(p.advisoryOnly, true);
    assert.equal(p.noAtsStageChange, true);
    assert.equal(p.noAiInput, true);
    assert.ok(!/"(score|recommendation|decision|verdict)"/i.test(JSON.stringify(p)));
  });

  it("15. revoke → 404; rotation invalidates the old link; expiry → 410", async () => {
    assert.equal((await staff("DELETE", "/assessment/link")).res.status, 200);
    assert.equal((await hub(hubToken)).res.status, 404);
    const rotated = await staff("POST", "/assessment/link", {});
    assert.equal(rotated.res.status, 201);
    assert.equal(rotated.json.rotated, true);
    const fresh = rotated.json.candidatePath.split("/").pop();
    assert.notEqual(fresh, hubToken);
    assert.equal((await hub(hubToken)).res.status, 404);
    assert.equal((await hub(fresh)).res.status, 200);
    await db.candidateAssessmentLink.update({ where: { applicationId: appX.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await hub(fresh)).res.status, 410);
    assert.equal(await db.candidateAssessmentLink.count({ where: { applicationId: appX.id } }), 1, "one link per application");
  });

  it("16. wrong application: the other application's assessment shows nothing assigned", async () => {
    const { res, json } = await staff("GET", "/assessment", undefined, recruiterCookie, appY.id);
    assert.equal(res.status, 200);
    assert.ok(json.assessment.components.every((c) => c.state === "NOT_ASSIGNED"));
    assert.equal(json.assessment.practicals.length, 0);
    assert.equal(json.assessment.interview, null);
    assert.equal(json.assessment.hubLink, null);
  });

  it("16b. pre-V3.1 applications: status is computed on read, but a page view writes no audit rows", async () => {
    await db.interviewSession.create({
      data: { applicationId: appY.id, status: "COMPLETED", accessToken: crypto.randomBytes(24).toString("base64url"), endedAt: new Date() },
    });
    const { json } = await staff("GET", "/assessment", undefined, recruiterCookie, appY.id);
    assert.equal(json.assessment.overall, "COMPLETED");
    assert.equal(json.assessment.interview.blueprintLinked, false);
    assert.equal(await db.timelineEvent.count({ where: { applicationId: appY.id } }), 0);
    const app = await db.application.findUnique({ where: { id: appY.id }, select: { stage: true } });
    assert.equal(app.stage, "SCREENING");
  });

  it("17. no stage change, no AIEvaluation, no proctoring rows; audit events are advisory and carry no tokens", async () => {
    const app = await db.application.findUnique({ where: { id: appX.id }, select: { stage: true, status: true } });
    assert.deepEqual(app, stageBefore);
    assert.equal(await db.aIEvaluation.count({ where: { applicationId: appX.id } }), 0);
    assert.equal(await db.proctoringEvent.count({ where: { sessionId: interviewId } }), 0);
    const events = await db.timelineEvent.findMany({ where: { applicationId: appX.id } });
    assert.ok(!events.some((e) => e.type === "STAGE_CHANGED"));
    const assessment = events.filter((e) => /^assessment_/.test(e.payload?.kind ?? ""));
    const kinds = assessment.map((e) => e.payload.kind);
    for (const k of ["assessment_link_issued", "assessment_link_revoked", "assessment_completed"]) assert.ok(kinds.includes(k), k);
    for (const e of assessment) {
      assert.equal(e.type, "OTHER");
      if (e.payload.kind === "assessment_question_generation_failed") continue;
      assert.equal(e.payload.advisoryOnly, true);
      assert.equal(e.payload.noAtsStageChange, true);
      const raw = JSON.stringify(e.payload);
      assert.ok(!raw.includes(hubToken) && !raw.includes(interviewToken) && !raw.includes(sqlToken), "no tokens in audit");
    }
  });
});
