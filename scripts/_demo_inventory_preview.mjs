/**
 * Read-only demo-readiness inventory. Does not delete or mutate anything.
 * Run: node --env-file=.env scripts/_demo_inventory_preview.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const R3_SESSION_ID = "cmsx3w7l5000bux4itdln83oc";
const KEEP_STAFF = new Set([
  "admin@local.dev",
  "hr@local.dev",
  "recruiter@local.dev",
  "hm@local.dev",
  "interviewer@local.dev",
  "candidate@local.dev",
]);
const DEMO_EMAIL_RE = /@logihiring\.example$/i;
const TEST_EMAIL_RE =
  /(uat|e2e|test|testcase|iso-|isolation|mallory|phase9|apply-test|apply-pdf|portal-\d+|temp-deact|deactivation-probe|ghost-probe|hardening-cookie|breach)/i;
const TEST_TITLE_RE = /\b(TEST|UAT|e2e)\b|^TEST\s|Speclist/i;
const TEST_SOURCE_RE = /isolation|uat|e2e|test/i;

function flagEmail(email) {
  if (KEEP_STAFF.has(email)) return "KEEP_STAFF";
  if (DEMO_EMAIL_RE.test(email)) return "DEMO_SEED";
  if (TEST_EMAIL_RE.test(email)) return "TEST";
  if (/@gmail\.com$/i.test(email)) return "OPERATOR_GMAIL";
  if (/@example\.com$/i.test(email)) return "TEST";
  if (/@local\.dev$/i.test(email) && !KEEP_STAFF.has(email)) return "TEST";
  return "REVIEW";
}

function flagTitle(title) {
  if (TEST_TITLE_RE.test(title)) return "TEST";
  return "OK";
}

function printTable(rows) {
  for (const r of rows) console.log("  " + r);
}

async function main() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, slug: true },
  });
  const depts = await prisma.department.findMany({
    select: { id: true, name: true, organizationId: true },
  });
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      location: true,
      createdAt: true,
      department: { select: { name: true } },
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const candidates = await prisma.candidate.findMany({
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      userId: true,
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const applications = await prisma.application.findMany({
    select: {
      id: true,
      stage: true,
      status: true,
      source: true,
      createdAt: true,
      candidate: { select: { email: true, firstName: true, lastName: true } },
      job: { select: { title: true } },
      _count: {
        select: {
          interviewSessions: true,
          aiEvaluations: true,
          timelineEvents: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const sessions = await prisma.interviewSession.findMany({
    select: {
      id: true,
      status: true,
      proctoringEnabled: true,
      proctoringMode: true,
      integrityMode: true,
      secondaryRecordingPath: true,
      createdAt: true,
      application: {
        select: {
          id: true,
          stage: true,
          candidate: { select: { email: true, firstName: true, lastName: true } },
          job: { select: { title: true } },
        },
      },
      _count: {
        select: {
          questions: true,
          answers: true,
          proctoring: true,
          aiEvaluations: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const evals = await prisma.aIEvaluation.findMany({
    select: {
      id: true,
      kind: true,
      scores: true,
      recommendation: true,
      model: true,
      sessionId: true,
      applicationId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const timelineKinds = await prisma.timelineEvent.groupBy({
    by: ["type"],
    _count: { _all: true },
  });
  const r3 = await prisma.interviewSession.findUnique({
    where: { id: R3_SESSION_ID },
    select: {
      id: true,
      status: true,
      createdAt: true,
      applicationId: true,
      application: {
        select: {
          stage: true,
          candidate: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          job: { select: { id: true, title: true } },
        },
      },
      _count: {
        select: { questions: true, answers: true, aiEvaluations: true },
      },
    },
  });
  const r3Timeline = r3
    ? await prisma.timelineEvent.findMany({
        where: { applicationId: r3.applicationId },
        select: { id: true, type: true, payload: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const r3Evals = r3
    ? await prisma.aIEvaluation.findMany({
        where: {
          OR: [{ sessionId: r3.id }, { applicationId: r3.applicationId }],
        },
        select: {
          id: true,
          kind: true,
          scores: true,
          recommendation: true,
          model: true,
          createdAt: true,
        },
      })
    : [];
  const counts = {
    orgs: orgs.length,
    depts: depts.length,
    users: users.length,
    jobs: jobs.length,
    candidates: candidates.length,
    applications: applications.length,
    sessions: sessions.length,
    evals: evals.length,
    timeline: await prisma.timelineEvent.count(),
    proctoring: await prisma.proctoringEvent.count(),
    questions: await prisma.interviewQuestion.count(),
    answers: await prisma.interviewAnswer.count(),
    notes: await prisma.note.count(),
  };
  const stageHist = await prisma.application.groupBy({
    by: ["stage"],
    _count: { _all: true },
  });
  const sessionHist = await prisma.interviewSession.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const preserveIds = {
    sessionIds: new Set(r3 ? [r3.id] : []),
    applicationIds: new Set(r3 ? [r3.applicationId] : []),
    candidateEmails: new Set(
      r3?.application?.candidate?.email ? [r3.application.candidate.email] : [],
    ),
    jobIds: new Set(r3?.application?.job?.id ? [r3.application.job.id] : []),
  };

  const userFlags = users.map((u) => ({ ...u, flag: flagEmail(u.email) }));
  const jobFlags = jobs.map((j) => ({
    ...j,
    flag: preserveIds.jobIds.has(j.id) ? "PRESERVE_R3" : flagTitle(j.title),
  }));
  const candFlags = candidates.map((c) => ({
    ...c,
    flag: preserveIds.candidateEmails.has(c.email)
      ? "PRESERVE_R3"
      : flagEmail(c.email),
  }));
  const appFlags = applications.map((a) => {
    const emailFlag = preserveIds.applicationIds.has(a.id)
      ? "PRESERVE_R3"
      : flagEmail(a.candidate.email);
    const srcFlag =
      a.source && TEST_SOURCE_RE.test(a.source) ? "TEST" : emailFlag;
    return { ...a, flag: emailFlag === "PRESERVE_R3" ? "PRESERVE_R3" : srcFlag };
  });
  const sessFlags = sessions.map((s) => {
    if (preserveIds.sessionIds.has(s.id)) return { ...s, flag: "PRESERVE_R3" };
    return {
      ...s,
      flag: flagEmail(s.application.candidate.email),
    };
  });

  console.log("=== HIREOS DEMO READINESS INVENTORY (READ-ONLY) ===");
  console.log(JSON.stringify(counts, null, 2));
  console.log("\n--- Organizations ---");
  printTable(orgs.map((o) => `${o.slug} | ${o.name} | ${o.id}`));
  console.log("\n--- Departments ---");
  printTable(depts.map((d) => d.name));
  console.log("\n--- Users ---");
  printTable(
    userFlags.map(
      (u) =>
        `[${u.flag}] ${u.role} ${u.isActive ? "active" : "inactive"} ${u.email} | ${u.name} | ${u.createdAt.toISOString()}`,
    ),
  );
  console.log("\n--- Jobs ---");
  printTable(
    jobFlags.map(
      (j) =>
        `[${j.flag}] ${j.status} apps=${j._count.applications} | ${j.title} | ${j.department?.name ?? "—"} | ${j.location ?? "—"} | ${j.id} | ${j.createdAt.toISOString()}`,
    ),
  );
  console.log("\n--- Candidates ---");
  printTable(
    candFlags.map(
      (c) =>
        `[${c.flag}] ${c.firstName} ${c.lastName} <${c.email}> apps=${c._count.applications} | ${c.id} | ${c.createdAt.toISOString()}`,
    ),
  );
  console.log("\n--- Applications ---");
  printTable(
    appFlags.map(
      (a) =>
        `[${a.flag}] ${a.stage}/${a.status} src=${a.source ?? "—"} | ${a.candidate.firstName} ${a.candidate.lastName} → ${a.job.title} | sessions=${a._count.interviewSessions} evals=${a._count.aiEvaluations} | ${a.id} | ${a.createdAt.toISOString()}`,
    ),
  );
  console.log("\n--- Interview sessions ---");
  printTable(
    sessFlags.map(
      (s) =>
        `[${s.flag}] ${s.status} ${s.proctoringMode}/${s.integrityMode} q=${s._count.questions} a=${s._count.answers} proc=${s._count.proctoring} eval=${s._count.aiEvaluations} | ${s.application.candidate.firstName} ${s.application.candidate.lastName} / ${s.application.job.title} | ${s.id} | ${s.createdAt.toISOString()} rec=${s.secondaryRecordingPath ?? "none"}`,
    ),
  );
  console.log("\n--- AI evaluations ---");
  printTable(
    evals.map((e) => {
      const overall =
        e.scores && typeof e.scores === "object" && e.scores !== null && "overall" in e.scores
          ? e.scores.overall
          : "—";
      return `${e.kind} overall=${overall} rec=${e.recommendation} model=${e.model} session=${e.sessionId ?? "—"} app=${e.applicationId} | ${e.id} | ${e.createdAt.toISOString()}`;
    }),
  );
  console.log("\n--- Pipeline stages ---");
  printTable(stageHist.map((s) => `${s.stage}: ${s._count._all}`));
  console.log("\n--- Session statuses ---");
  printTable(sessionHist.map((s) => `${s.status}: ${s._count._all}`));
  console.log("\n--- Timeline types ---");
  printTable(timelineKinds.map((t) => `${t.type}: ${t._count._all}`));

  console.log("\n=== R-3 EVIDENCE SESSION ===");
  if (!r3) {
    console.log("NOT FOUND:", R3_SESSION_ID);
  } else {
    console.log(
      JSON.stringify(
        {
          sessionId: r3.id,
          status: r3.status,
          applicationId: r3.applicationId,
          stage: r3.application.stage,
          candidate: r3.application.candidate,
          job: r3.application.job,
          questions: r3._count.questions,
          answers: r3._count.answers,
          aiEvaluationsOnSession: r3._count.aiEvaluations,
          evals: r3Evals,
          timeline: r3Timeline.map((t) => ({
            type: t.type,
            createdAt: t.createdAt,
            payloadKeys:
              t.payload && typeof t.payload === "object"
                ? Object.keys(t.payload)
                : [],
            kind:
              t.payload &&
              typeof t.payload === "object" &&
              t.payload !== null &&
              "kind" in t.payload
                ? t.payload.kind
                : undefined,
            status:
              t.payload &&
              typeof t.payload === "object" &&
              t.payload !== null &&
              "status" in t.payload
                ? t.payload.status
                : undefined,
          })),
        },
        null,
        2,
      ),
    );
  }

  const proposedUsers = userFlags.filter(
    (u) => u.flag === "TEST" || u.flag === "OPERATOR_GMAIL",
  );
  const proposedCands = candFlags.filter(
    (c) =>
      c.flag === "TEST" ||
      c.flag === "OPERATOR_GMAIL" ||
      c.flag === "REVIEW",
  );
  const proposedJobs = jobFlags.filter((j) => j.flag === "TEST");
  const proposedApps = appFlags.filter(
    (a) => a.flag === "TEST" || a.flag === "OPERATOR_GMAIL",
  );
  const proposedSess = sessFlags.filter(
    (s) => s.flag === "TEST" || s.flag === "OPERATOR_GMAIL",
  );
  const demoJobs = jobFlags.filter((j) => j.flag === "OK");
  const demoCands = candFlags.filter(
    (c) => c.flag === "DEMO_SEED" || c.flag === "KEEP_STAFF",
  );
  const demoApps = appFlags.filter(
    (a) => a.flag === "DEMO_SEED" || a.flag === "KEEP_STAFF",
  );

  console.log("\n=== CLASSIFICATION SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        keepStaffUsers: userFlags.filter((u) => u.flag === "KEEP_STAFF").length,
        demoSeedCandidates: candFlags.filter((c) => c.flag === "DEMO_SEED")
          .length,
        demoSeedApps: demoApps.length,
        preserveR3: {
          found: Boolean(r3),
          sessionId: r3?.id ?? null,
          applicationId: r3?.applicationId ?? null,
          candidateEmail: r3?.application?.candidate?.email ?? null,
          jobTitle: r3?.application?.job?.title ?? null,
        },
        proposedRemove: {
          users: proposedUsers.length,
          candidates: proposedCands.length,
          jobs: proposedJobs.length,
          applications: proposedApps.length,
          sessions: proposedSess.length,
        },
        needsHumanReview: candFlags.filter((c) => c.flag === "REVIEW").length,
      },
      null,
      2,
    ),
  );

  console.log("\n=== PROPOSED REMOVAL PREVIEW (NOT DELETED) ===");
  console.log("-- Users --");
  printTable(
    proposedUsers.length
      ? proposedUsers.map((u) => `${u.email} | ${u.name} | ${u.role}`)
      : ["(none)"],
  );
  console.log("-- Candidates --");
  printTable(
    proposedCands.length
      ? proposedCands.map(
          (c) => `${c.firstName} ${c.lastName} <${c.email}> ${c.id}`,
        )
      : ["(none)"],
  );
  console.log("-- Jobs --");
  printTable(
    proposedJobs.length
      ? proposedJobs.map((j) => `${j.title} ${j.id}`)
      : ["(none)"],
  );
  console.log("-- Applications --");
  printTable(
    proposedApps.length
      ? proposedApps.map(
          (a) =>
            `${a.candidate.email} → ${a.job.title} ${a.stage} ${a.id}`,
        )
      : ["(none)"],
  );
  console.log("-- Sessions --");
  printTable(
    proposedSess.length
      ? proposedSess.map(
          (s) =>
            `${s.id} ${s.status} ${s.application.candidate.email}`,
        )
      : ["(none)"],
  );
  console.log("\n=== KEEP / DEMO SEED (not proposed for removal) ===");
  console.log(
    `jobs=${demoJobs.length} candidates=${demoCands.length} applications=${demoApps.length}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
