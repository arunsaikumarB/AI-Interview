/**
 * Read-only: inspect R-3 remnants and post-seed UAT/live-audit rows.
 * Run: node --env-file=.env scripts/_demo_audit_detail.mjs
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, readdirSync } from "fs";
import path from "path";

const prisma = new PrismaClient();
const R3 = "cmsx3w7l5000bux4itdln83oc";
const STORAGE = path.resolve(process.env.STORAGE_ROOT ?? "./storage");

async function main() {
  const sessionHit = await prisma.interviewSession.findFirst({
    where: { id: { contains: "cmsx3w7l5" } },
    select: { id: true },
  });
  const evalHit = await prisma.aIEvaluation.findMany({
    where: {
      OR: [{ sessionId: R3 }, { reasoning: { contains: R3 } }],
    },
    select: { id: true, sessionId: true, kind: true, model: true },
  });
  const tlHit = await prisma.$queryRaw`
    SELECT id, type, "applicationId", "createdAt", payload
    FROM "TimelineEvent"
    WHERE payload::text LIKE ${"%" + R3 + "%"}
       OR id = ${R3}
  `;

  console.log("R-3 session row:", sessionHit);
  console.log("R-3 eval hits:", evalHit);
  console.log("R-3 timeline payload hits:", tlHit);

  const vikram = await prisma.candidate.findFirst({
    where: { email: "vikram.singh@logihiring.example" },
    include: {
      applications: {
        include: {
          job: { select: { title: true } },
          timelineEvents: { orderBy: { createdAt: "asc" } },
          interviewSessions: {
            include: {
              _count: {
                select: {
                  questions: true,
                  answers: true,
                  proctoring: true,
                  aiEvaluations: true,
                },
              },
            },
          },
          aiEvaluations: true,
        },
      },
    },
  });
  console.log("\n=== VIKRAM ===");
  console.log(
    JSON.stringify(
      vikram?.applications.map((a) => ({
        appId: a.id,
        stage: a.stage,
        status: a.status,
        job: a.job.title,
        sessions: a.interviewSessions.map((s) => ({
          id: s.id,
          status: s.status,
          proctoringMode: s.proctoringMode,
          integrityMode: s.integrityMode,
          createdAt: s.createdAt,
          counts: s._count,
          recPath: s.secondaryRecordingPath,
        })),
        evals: a.aiEvaluations.map((e) => ({
          id: e.id,
          kind: e.kind,
          model: e.model,
          rec: e.recommendation,
          sessionId: e.sessionId,
          createdAt: e.createdAt,
        })),
        timeline: a.timelineEvents.map((t) => ({
          type: t.type,
          createdAt: t.createdAt,
          payload: t.payload,
        })),
      })),
      null,
      2,
    ),
  );

  const extraSessions = await prisma.interviewSession.findMany({
    where: {
      createdAt: { gt: new Date("2026-08-17T11:10:00.000Z") },
    },
    select: {
      id: true,
      status: true,
      proctoringMode: true,
      integrityMode: true,
      createdAt: true,
      application: {
        select: {
          stage: true,
          candidate: { select: { email: true, firstName: true, lastName: true } },
          job: { select: { title: true } },
        },
      },
    },
  });
  console.log("\n=== SESSIONS AFTER DEMO SEED (11:10Z) ===");
  console.log(JSON.stringify(extraSessions, null, 2));

  const extraEvals = await prisma.aIEvaluation.findMany({
    where: { model: { not: "demo-seed" } },
    select: {
      id: true,
      kind: true,
      model: true,
      recommendation: true,
      sessionId: true,
      applicationId: true,
      createdAt: true,
    },
  });
  console.log("\n=== NON demo-seed EVALUATIONS ===");
  console.log(JSON.stringify(extraEvals, null, 2));

  const procTypes = await prisma.proctoringEvent.groupBy({
    by: ["type"],
    _count: { _all: true },
  });
  console.log("\n=== PROCTORING TYPES ===");
  console.log(procTypes);

  const interviewsDir = path.join(STORAGE, "interviews");
  console.log("\n=== STORAGE interviews/ ===", interviewsDir, existsSync(interviewsDir));
  if (existsSync(interviewsDir)) {
    console.log(readdirSync(interviewsDir));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
