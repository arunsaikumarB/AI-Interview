/**
 * R-3 — AI evaluation failure / retry / persistence, against the real database
 * and the real API.
 *
 * The unit tests pin the logic; these pin the wiring:
 *   - a failure is durable in TimelineEvent and survives re-reads
 *   - the API reports it as `failed`, distinct from `pending`
 *   - a failure NEVER creates an AIEvaluation row and fabricates no score
 *   - Application.stage is untouched on the failure path
 *   - a later real evaluation supersedes the failure breadcrumb
 *   - retry stays staff-only
 *
 *   BASE_URL=http://localhost:3000 npx tsx --test tests/isolation/evaluation-failure.test.mjs
 */
import "./load-env.mjs";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SignJWT } from "jose";
import { prisma } from "./helpers.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const health = await fetch(`${BASE}/api/health`).catch(() => null);
assert.ok(health, `App must be reachable at ${BASE}`);
assert.equal(
  (await health.json())?.database?.ok,
  true,
  "Postgres must be up for the R-3 database-backed tests",
);

const db = prisma();
let application;
let session;
let staffCookie;
const created = { sessions: [], events: [], evaluations: [] };

async function mint(user) {
  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  return `aros_session=${token}`;
}

async function getInterview(cookie = staffCookie) {
  const res = await fetch(`${BASE}/api/interviews/${session.id}`, {
    headers: { Cookie: cookie },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Write exactly what src/lib/ai/evaluation-status.ts produces on final failure. */
async function recordFailure(overrides = {}) {
  const row = await db.timelineEvent.create({
    data: {
      applicationId: application.id,
      type: "AI_EVALUATION",
      payload: {
        sessionId: session.id,
        kind: "INTERVIEW_OVERALL",
        status: "failed",
        advisoryOnly: true,
        attempts: 3,
        error: "Ollama is unreachable at http://localhost:11434",
        ...overrides,
      },
    },
  });
  created.events.push(row.id);
  return row;
}

before(async () => {
  application = await db.application.findFirst({ orderBy: { createdAt: "asc" } });
  assert.ok(application, "No application — run db:seed first");

  const staff = await db.user.findFirst({ where: { role: "HR_ADMIN", isActive: true } });
  staffCookie = await mint(staff);

  session = await db.interviewSession.create({
    data: {
      applicationId: application.id,
      accessToken: crypto.randomBytes(32).toString("hex"),
      status: "COMPLETED",
      deliveryMode: "TEXT",
      interviewType: "TECHNICAL",
      maxQuestions: 3,
      startedAt: new Date(Date.now() - 600_000),
      endedAt: new Date(Date.now() - 60_000),
    },
  });
  created.sessions.push(session.id);
});

after(async () => {
  await db.aIEvaluation.deleteMany({ where: { id: { in: created.evaluations } } });
  await db.timelineEvent.deleteMany({ where: { id: { in: created.events } } });
  await db.interviewSession.deleteMany({ where: { id: { in: created.sessions } } });
  await db.$disconnect();
});

describe("R-3 pending is not reported as failed", () => {
  it("a completed interview with no evaluation and no failure reads as pending", async () => {
    const { status, body } = await getInterview();
    assert.equal(status, 200);
    assert.equal(body.evaluationStatus.state, "pending");
    assert.equal(body.evaluationStatus.canRetry, true);
    assert.equal(body.overall, null);
  });

  it("pending carries no error text and no attempt count", async () => {
    const { body } = await getInterview();
    assert.equal(body.evaluationStatus.error, undefined);
    assert.equal(body.evaluationStatus.attempts, undefined);
  });
});

describe("R-3 a recorded failure is durable and surfaced", () => {
  before(async () => {
    await recordFailure();
  });

  it("the API reports state=failed", async () => {
    const { body } = await getInterview();
    assert.equal(body.evaluationStatus.state, "failed");
  });

  it("it reports how many attempts were made", async () => {
    const { body } = await getInterview();
    assert.equal(body.evaluationStatus.attempts, 3);
  });

  it("it carries an operator-readable reason", async () => {
    const { body } = await getInterview();
    assert.match(String(body.evaluationStatus.error), /unreachable/i);
  });

  it("it offers retry", async () => {
    const { body } = await getInterview();
    assert.equal(body.evaluationStatus.canRetry, true);
  });

  it("PERSISTENCE: the failure survives repeated reads", async () => {
    for (let i = 0; i < 3; i++) {
      const { body } = await getInterview();
      assert.equal(body.evaluationStatus.state, "failed", `read ${i + 1}`);
    }
  });

  it("PERSISTENCE: the row is in the database, not just the response", async () => {
    const rows = await db.timelineEvent.findMany({
      where: { applicationId: application.id, type: "AI_EVALUATION" },
    });
    const mine = rows.filter((r) => r.payload?.sessionId === session.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].payload.status, "failed");
    assert.equal(mine[0].payload.advisoryOnly, true);
  });
});

describe("R-3 nothing is fabricated", () => {
  it("NO AIEvaluation row exists for the failed session", async () => {
    const n = await db.aIEvaluation.count({ where: { sessionId: session.id } });
    assert.equal(n, 0, "a failure must never leave anything that reads as a result");
  });

  it("the API returns overall: null, not a placeholder", async () => {
    const { body } = await getInterview();
    assert.equal(body.overall, null);
  });

  it("the failure payload contains no score, recommendation or reasoning", async () => {
    const row = await db.timelineEvent.findFirst({
      where: { applicationId: application.id, type: "AI_EVALUATION" },
      orderBy: { createdAt: "desc" },
    });
    for (const key of ["overall", "score", "recommendation", "reasoning", "confidence"]) {
      assert.ok(
        !(key in row.payload),
        `failure payload leaked "${key}": ${JSON.stringify(row.payload)}`,
      );
    }
  });

  it("the evaluationStatus block itself leaks no score", async () => {
    const { body } = await getInterview();
    const raw = JSON.stringify(body.evaluationStatus);
    assert.ok(!/"overall"/.test(raw), raw);
    assert.ok(!/"recommendation"/.test(raw), raw);
  });
});

describe("R-3 advisory-only is preserved on the failure path", () => {
  it("Application.stage is unchanged", async () => {
    const before = application.stage;
    const now = await db.application.findUnique({ where: { id: application.id } });
    assert.equal(now.stage, before);
  });

  it("Application.status is unchanged", async () => {
    const now = await db.application.findUnique({ where: { id: application.id } });
    assert.equal(now.status, application.status);
  });

  it("no ProctoringEvent was created by the failure", async () => {
    const n = await db.proctoringEvent.count({ where: { sessionId: session.id } });
    assert.equal(n, 0);
  });

  it("the API still advertises advisoryOnly", async () => {
    const { body } = await getInterview();
    assert.equal(body.advisoryOnly, true);
  });
});

describe("R-3 a real evaluation supersedes the failure", () => {
  before(async () => {
    const ev = await db.aIEvaluation.create({
      data: {
        applicationId: application.id,
        sessionId: session.id,
        kind: "INTERVIEW_OVERALL",
        scores: { overall: 71, communication: 70, technical: 72, problemSolving: 70, culture: 70 },
        recommendation: "YES",
        reasoning: "Recovered on retry.",
        model: "isolation-test",
        rawResponse: {},
      },
    });
    created.evaluations.push(ev.id);
  });

  it("state flips to completed even though the failure row is still there", async () => {
    const { body } = await getInterview();
    assert.equal(body.evaluationStatus.state, "completed");
  });

  it("the earlier failure row was NOT deleted — the audit trail survives", async () => {
    const rows = await db.timelineEvent.findMany({
      where: { applicationId: application.id, type: "AI_EVALUATION" },
    });
    assert.ok(rows.some((r) => r.payload?.sessionId === session.id && r.payload?.status === "failed"));
  });

  it("the real evaluation is returned", async () => {
    const { body } = await getInterview();
    assert.ok(body.overall);
    assert.equal(body.overall.recommendation, "YES");
  });
});

describe("R-3 retry is staff-only", () => {
  it("anonymous cannot trigger a retry", async () => {
    const res = await fetch(`${BASE}/api/interviews/${session.id}/regenerate-evaluation`, {
      method: "POST",
      redirect: "manual",
    });
    assert.ok(res.status === 401 || res.status === 403, `status=${res.status}`);
  });

  it("a candidate cannot trigger a retry", async () => {
    const cand = await db.user.findFirst({ where: { role: "CANDIDATE", isActive: true } });
    const res = await fetch(`${BASE}/api/interviews/${session.id}/regenerate-evaluation`, {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: await mint(cand) },
    });
    assert.ok(res.status === 401 || res.status === 403, `status=${res.status}`);
  });

  it("the interview detail endpoint is staff-only too", async () => {
    const res = await fetch(`${BASE}/api/interviews/${session.id}`, { redirect: "manual" });
    assert.ok(res.status === 401 || res.status === 403, `status=${res.status}`);
  });
});

describe("R-3 an in-progress interview is not awaiting an evaluation", () => {
  let running;

  before(async () => {
    running = await db.interviewSession.create({
      data: {
        applicationId: application.id,
        accessToken: crypto.randomBytes(32).toString("hex"),
        status: "IN_PROGRESS",
        deliveryMode: "TEXT",
        interviewType: "TECHNICAL",
        maxQuestions: 3,
        startedAt: new Date(),
      },
    });
    created.sessions.push(running.id);
  });

  it("reads as not_applicable, so the UI shows no alarm mid-interview", async () => {
    const res = await fetch(`${BASE}/api/interviews/${running.id}`, {
      headers: { Cookie: staffCookie },
    });
    const body = await res.json();
    assert.equal(body.evaluationStatus.state, "not_applicable");
    assert.equal(body.evaluationStatus.canRetry, false);
  });
});
