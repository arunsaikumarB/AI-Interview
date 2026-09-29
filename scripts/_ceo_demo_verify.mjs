import { existsSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const R3 = "cmsx3w7l5000bux4itdln83oc";
const STORAGE = path.resolve(process.env.STORAGE_ROOT ?? "./storage");

async function main() {
  const seedJobs = [
    "Senior Full Stack Engineer",
    "Frontend React Developer",
    "Product Designer (UI/UX)",
    "Product Manager",
    "HR Business Partner",
    "Sales Account Executive",
  ];
  const jobs = await prisma.job.findMany({ select: { title: true } });
  const seedJobOk = seedJobs.every((t) => jobs.some((j) => j.title === t));
  const seedCands = await prisma.candidate.count({
    where: {
      OR: [
        { email: { endsWith: "@logihiring.example" } },
        { email: "candidate@local.dev" },
      ],
    },
  });
  const stages = await prisma.application.groupBy({ by: ["stage"], _count: { _all: true } });
  const stageSum = stages.reduce((n, s) => n + s._count._all, 0);
  const appCount = await prisma.application.count();
  const orphanApps = await prisma.$queryRaw`
    SELECT a.id FROM "Application" a
    LEFT JOIN "Candidate" c ON c.id = a."candidateId"
    LEFT JOIN "Job" j ON j.id = a."jobId"
    WHERE c.id IS NULL OR j.id IS NULL
  `;
  const orphanSessions = await prisma.$queryRaw`
    SELECT s.id FROM "InterviewSession" s
    LEFT JOIN "Application" a ON a.id = s."applicationId"
    WHERE a.id IS NULL
  `;
  const orphanEvals = await prisma.$queryRaw`
    SELECT e.id FROM "AIEvaluation" e
    LEFT JOIN "Application" a ON a.id = e."applicationId"
    WHERE a.id IS NULL
  `;
  const seedEvals = await prisma.aIEvaluation.findMany({
    where: { model: "demo-seed" },
    select: { recommendation: true, scores: true },
  });
  const staff = await prisma.user.findMany({
    select: { email: true, role: true },
    orderBy: { email: "asc" },
  });
  const r3Disk = existsSync(path.join(STORAGE, "interviews", R3, "q1.wav"));
  const vikram = await prisma.application.findUnique({
    where: { id: "cmsx4n2o5002si2vops3lukik" },
    select: { stage: true, status: true },
  });
  const ceoApps = await prisma.application.findMany({
    where: { source: "ceo_demo_2026_08_17" },
    include: {
      timelineEvents: { select: { type: true } },
      interviewSessions: {
        include: { _count: { select: { questions: true, answers: true } } },
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        seedJobOk,
        seedCands,
        appCount,
        stageSum,
        match: appCount === stageSum,
        orphanApps,
        orphanSessions,
        orphanEvals,
        seedEvals: seedEvals.map((e) => ({
          rec: e.recommendation,
          overall: e.scores?.overall,
        })),
        staff,
        r3Disk,
        vikram,
        ceoTimelines: ceoApps.map((a) => ({
          id: a.id,
          stage: a.stage,
          timeline: a.timelineEvents.map((t) => t.type),
          sessions: a.interviewSessions.map((s) => ({
            status: s.status,
            q: s._count.questions,
            a: s._count.answers,
          })),
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
