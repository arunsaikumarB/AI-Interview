/**
 * R-3 for practical execution, against the real database: when the sandbox
 * runner is unreachable, a frozen submission gets bounded retries and an
 * honest EXECUTION_FAILED record — no fabricated counts, no AIEvaluation, no
 * stage change. Also covers recovery of an abandoned execution.
 * Temporary organisation-scoped fixtures are created and removed here.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { prisma } from "../../src/lib/db";
import { EXECUTION_STALE_MS, executeSubmission, listPracticalAssessments } from "../../src/lib/practical/service";
import { SQL_TASKS } from "../../src/lib/practical/tasks";
import type { SessionUser } from "../../src/lib/auth/session";

const task = SQL_TASKS[0];

describe("practical execution failure handling (real DB, runner unreachable)", () => {
  const ids: { user?: string; job?: string; candidate?: string; application?: string } = {};
  let orgId = "";
  const savedEnv = { url: process.env.SANDBOX_RUNNER_URL, secret: process.env.SANDBOX_RUNNER_SECRET };

  async function frozenAssessment(submittedAt: Date, status: "SUBMITTED" | "EXECUTING" = "SUBMITTED") {
    const a = await prisma.practicalAssessment.create({
      data: {
        applicationId: ids.application!,
        type: "SQL",
        taskKey: task.key,
        taskVersion: task.version,
        competency: "SQL",
        difficulty: task.difficulty,
        provenance: { test: true },
        accessTokenHash: crypto.randomBytes(32).toString("hex"),
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
        timeLimitMinutes: task.timeLimitMinutes,
        status,
        startedAt: new Date(submittedAt.getTime() - 60_000),
        submittedAt,
      },
    });
    const source = "SELECT city, count(*) FROM customers GROUP BY city";
    const s = await prisma.practicalSubmission.create({
      data: {
        assessmentId: a.id,
        language: "postgresql",
        source,
        sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
        sizeBytes: Buffer.byteLength(source),
        taskVersion: task.version,
        runnerVersion: "practical-runtime-v3.0",
        submittedAt,
        execStatus: status === "EXECUTING" ? "EXECUTING" : "PENDING",
      },
    });
    return { assessmentId: a.id, submissionId: s.id };
  }

  before(async () => {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    assert.ok(org, "seeded organisation required");
    orgId = org.id;
    const stamp = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const user = await prisma.user.create({
      data: { email: `r3-practical-${stamp}@example.com`, name: "R3 fixture", role: "RECRUITER", passwordHash: "x", organizationId: orgId, isActive: true },
    });
    ids.user = user.id;
    const job = await prisma.job.create({
      data: { organizationId: orgId, title: "R3 fixture job", description: "SQL analytics", status: "OPEN", createdById: user.id },
    });
    ids.job = job.id;
    const candidate = await prisma.candidate.create({
      data: { organizationId: orgId, email: `r3-cand-${stamp}@example.com`, firstName: "R3", lastName: "Fixture" },
    });
    ids.candidate = candidate.id;
    const app = await prisma.application.create({
      data: { candidateId: candidate.id, jobId: job.id, stage: "ASSESSMENT", status: "ACTIVE", source: "r3_test" },
    });
    ids.application = app.id;
    process.env.SANDBOX_RUNNER_URL = "http://127.0.0.1:9";
    process.env.SANDBOX_RUNNER_SECRET = "r3-test-secret-that-is-at-least-32-chars";
  });

  after(async () => {
    process.env.SANDBOX_RUNNER_URL = savedEnv.url;
    process.env.SANDBOX_RUNNER_SECRET = savedEnv.secret;
    if (ids.application) await prisma.application.deleteMany({ where: { id: ids.application } });
    if (ids.candidate) await prisma.candidate.deleteMany({ where: { id: ids.candidate } });
    if (ids.job) await prisma.job.deleteMany({ where: { id: ids.job } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  });

  it("unreachable runner → bounded retries, honest failure, no score, no stage change, no AIEvaluation", async () => {
    const { assessmentId, submissionId } = await frozenAssessment(new Date());
    const started = Date.now();
    await executeSubmission(submissionId);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 3500 && elapsed < 20_000, `two 2 s back-offs expected, took ${elapsed} ms`);

    const a = await prisma.practicalAssessment.findUniqueOrThrow({ where: { id: assessmentId }, include: { submission: true } });
    assert.equal(a.status, "EXECUTION_FAILED");
    assert.equal(a.submission?.execStatus, "EXECUTION_FAILED");
    const result = a.submission?.result as Record<string, unknown>;
    assert.equal(result.kind, "INFRASTRUCTURE");
    assert.equal(result.reason, "RUNNER_UNAVAILABLE");
    assert.equal(result.attempts, 3);
    for (const k of ["passed", "failed", "total", "correct", "score"]) assert.ok(!(k in result), `no fabricated ${k}`);

    const app = await prisma.application.findUniqueOrThrow({ where: { id: ids.application! } });
    assert.equal(app.stage, "ASSESSMENT");
    assert.equal(app.status, "ACTIVE");
    assert.equal(await prisma.aIEvaluation.count({ where: { applicationId: ids.application! } }), 0);
    const failed = await prisma.timelineEvent.findMany({ where: { applicationId: ids.application!, type: "OTHER" } });
    assert.ok(failed.some((e) => (e.payload as { kind?: string }).kind === "practical_assessment_failed"));
    assert.equal(await prisma.timelineEvent.count({ where: { applicationId: ids.application!, type: "AI_EVALUATION" } }), 0);

    // Executing again is a no-op: the result is written exactly once.
    await executeSubmission(submissionId);
    const again = await prisma.practicalSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    assert.deepEqual(again.result, a.submission?.result);
  });

  it("an execution abandoned by a crash/restart is recorded as failed, not left hanging or scored", async () => {
    const old = new Date(Date.now() - EXECUTION_STALE_MS - 60_000);
    const { assessmentId } = await frozenAssessment(old, "EXECUTING");
    const staff = { id: ids.user!, role: "RECRUITER", organizationId: orgId, email: "x", name: "x" } as unknown as SessionUser;
    const list = await listPracticalAssessments(staff, ids.application!);
    const row = list.find((r) => r.id === assessmentId);
    assert.equal(row?.status, "EXECUTION_FAILED");
    const sub = await prisma.practicalSubmission.findUniqueOrThrow({ where: { assessmentId } });
    assert.equal((sub.result as { reason?: string }).reason, "EXECUTION_ABANDONED");
    assert.equal(await prisma.aIEvaluation.count({ where: { applicationId: ids.application! } }), 0);
  });
});
