/**
 * Which application the background screening sweep picks next, against a THROWAWAY database.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/screening-sweep.db.test.ts
 *
 * The database name must end in "_test". Schema must already be pushed there.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const url = process.env.IMPORT_TEST_DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!dbName.endsWith("_test")) {
  throw new Error("Set IMPORT_TEST_DATABASE_URL to a throwaway database whose name ends in _test.");
}
process.env.DATABASE_URL = url;

import { findUnscreenedApplication } from "../../src/lib/ai/screening-sweep";
import { AUTO_SCREENING_FAILED_KIND } from "../../src/lib/ai/auto-screening";

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `ss${Date.now()}`;
let orgId: string;
let adminId: string;
const ids: Record<string, string> = {};

const RESUME = "Java developer, 5 years Spring Boot and AWS.";
/** Far-future creation dates so these rows are the newest in the database. */
const day = (d: number) => new Date(Date.UTC(2099, 0, d));
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function app(
  key: string,
  jobId: string,
  createdDay: number,
  resumeText: string | null,
  extra: { status?: "ACTIVE" | "REJECTED"; failures?: Date[]; evaluation?: "RESUME_SCREEN" | "INTERVIEW_OVERALL" } = {},
) {
  const candidate = await prisma.candidate.create({
    data: { organizationId: orgId, email: `${key}.${tag}@example.com`, firstName: key, lastName: "Test", resumeText },
  });
  const a = await prisma.application.create({
    data: { candidateId: candidate.id, jobId, status: extra.status ?? "ACTIVE", createdAt: day(createdDay) },
  });
  for (const at of extra.failures ?? []) {
    await prisma.timelineEvent.create({
      data: { applicationId: a.id, type: "OTHER", createdAt: at, payload: { kind: AUTO_SCREENING_FAILED_KIND, code: "OLLAMA_UNREACHABLE", automatic: true } },
    });
  }
  if (extra.evaluation) await screened(a.id, extra.evaluation);
  ids[key] = a.id;
}

async function screened(applicationId: string, kind: "RESUME_SCREEN" | "INTERVIEW_OVERALL" = "RESUME_SCREEN") {
  await prisma.aIEvaluation.create({
    data: { applicationId, kind, scores: { overall: 70 }, recommendation: "MAYBE", reasoning: "test", model: "test" },
  });
}

before(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Sweep ${tag}`, slug: tag } })).id;
  adminId = (
    await prisma.user.create({
      data: { email: `admin.${tag}@example.com`, passwordHash: "x", name: "Admin", role: "HR_ADMIN", organizationId: orgId },
    })
  ).id;
  const open = await prisma.job.create({
    data: { organizationId: orgId, title: "Open job", description: "d", status: "OPEN", createdById: adminId },
  });
  const closed = await prisma.job.create({
    data: { organizationId: orgId, title: "Closed job", description: "d", status: "CLOSED", createdById: adminId },
  });
  await app("fresh", open.id, 5, RESUME);
  await app("alreadyScreened", open.id, 6, RESUME, { evaluation: "RESUME_SCREEN" });
  await app("blankResume", open.id, 7, "   \n ");
  await app("noResume", open.id, 8, null);
  await app("failedThreeTimes", open.id, 9, RESUME, { failures: [minutesAgo(300), minutesAgo(200), minutesAgo(100)] });
  await app("failedJustNow", open.id, 10, RESUME, { failures: [minutesAgo(5)] });
  await app("failedLongAgo", open.id, 4, RESUME, { failures: [minutesAgo(120)] });
  await app("otherEvaluationOnly", open.id, 3, RESUME, { evaluation: "INTERVIEW_OVERALL" });
  await app("rejectedOnClosedJob", closed.id, 2, RESUME, { status: "REJECTED" });
});

after(async () => {
  await prisma.candidate.deleteMany({ where: { organizationId: orgId } });
  await prisma.job.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe("screening sweep: next application", () => {
  it("picks unscreened applications with a resume, newest first, on open and closed jobs alike", async () => {
    const mine = new Set(Object.values(ids));
    const picked: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = await findUnscreenedApplication(prisma);
      if (!id || !mine.has(id)) break;
      picked.push(Object.keys(ids).find((k) => ids[k] === id)!);
      await screened(id);
    }
    assert.deepEqual(picked, ["fresh", "failedLongAgo", "otherEvaluationOnly", "rejectedOnClosedJob"]);
  });

  it("retries a recent failure once the wait is over, and never after three failures", async () => {
    const id = await findUnscreenedApplication(prisma, 3, 1);
    assert.equal(id, ids.failedJustNow);
    await screened(id!);
    const next = await findUnscreenedApplication(prisma, 3, 1);
    assert.notEqual(next, ids.failedThreeTimes);
    assert.equal(await findUnscreenedApplication(prisma, 4, 1), ids.failedThreeTimes);
  });
});
