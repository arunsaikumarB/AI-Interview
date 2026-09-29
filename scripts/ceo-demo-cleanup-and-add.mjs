/**
 * Approved UAT residue cleanup + additive CEO-demo batch (17 Aug 2026).
 * Does not change Prisma schema, auth, AI, or interview engine code.
 * Does not wipe existing seeded jobs/candidates (Logi Hiring demo set).
 * Does not change Vikram Singh SELECTED/HIRED.
 *
 * Marker for later removal: source/email/payload/model contain
 *   ceo_demo_2026_08_17
 *
 * Run: node --env-file=.env scripts/ceo-demo-cleanup-and-add.mjs
 */
import { randomBytes } from "crypto";
import { rm, readdir } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BATCH = "ceo_demo_2026_08_17";
const ORG_SLUG = "acme-hiring";
const R3_SESSION_ID = "cmsx3w7l5000bux4itdln83oc";
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT ?? "./storage");
const KEEP_STAFF = [
  "admin@local.dev",
  "hr@local.dev",
  "recruiter@local.dev",
  "hm@local.dev",
  "interviewer@local.dev",
  "candidate@local.dev",
];
const UAT_SESSION_IDS = [
  "cmsx5y2pc000j9hs4k2wy5xsv",
  "cmsx65ges000n9hs4v4maav5q",
];
const VIKRAM_APP_ID = "cmsx4n2o5002si2vops3lukik";

function token() {
  return randomBytes(32).toString("hex");
}
function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}
function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

const JOBS = [
  {
    key: "backend",
    title: "Backend Platform Engineer",
    department: "Engineering",
    location: "Hyderabad / Hybrid",
    experienceMin: 4,
    experienceMax: 8,
    skills: ["Node.js", "PostgreSQL", "API design", "TypeScript", "Observability"],
    description: `We are hiring a Backend Platform Engineer to own APIs, data integrity, and reliability for recruiter-facing workflows.

Responsibilities
- Design and operate Node.js services against PostgreSQL
- Keep API contracts explicit and backwards-compatible
- Improve observability, failure handling, and local operability
- Partner with frontend and product on scoped delivery
- Review authentication, authorization, and data-access changes carefully

Requirements
- 4–8 years building production backend services
- Strong TypeScript or JavaScript and PostgreSQL
- Experience with REST APIs and operational debugging
- Comfortable with self-hosted constraints (no cloud-only shortcuts)
- Clear written communication with hiring managers and HR`,
  },
  {
    key: "analyst",
    title: "People Analytics Specialist",
    department: "People",
    location: "Bengaluru / Hybrid",
    experienceMin: 3,
    experienceMax: 6,
    skills: ["SQL", "Funnel metrics", "Dashboards", "Stakeholder communication", "Experiment design"],
    description: `Join People Analytics to make hiring funnel reporting honest, local, and useful for recruiters and hiring managers.

Responsibilities
- Define and maintain hiring funnel metrics that match pipeline stages
- Build dashboards recruiters can trust without a data team in the loop
- Investigate drops between screening, interview, and offer
- Partner with HRBPs on workforce questions, not vanity charts
- Document metric definitions so they survive staffing changes

Requirements
- 3–6 years in people analytics, BI, or operational analytics
- Strong SQL and comfort with messy operational data
- Evidence of turning funnel questions into decisions
- Clear writing for non-analyst stakeholders
- Experience with privacy-conscious, on-prem or local data`,
  },
  {
    key: "csm",
    title: "Customer Success Manager",
    department: "Sales",
    location: "Hyderabad / Hybrid",
    experienceMin: 3,
    experienceMax: 6,
    skills: ["Onboarding", "Renewals", "Discovery", "Executive communication", "Product feedback"],
    description: `Own post-sale success for mid-market customers running a self-hosted hiring platform.

Responsibilities
- Run structured onboarding with HR and IT stakeholders
- Keep renewals honest: value evidence, not slideware
- Surface product gaps from the field without over-promising
- Coordinate with support and engineering on operational issues
- Maintain clean account notes and next steps

Requirements
- 3–6 years in customer success or implementation for B2B software
- Comfort talking to HR operations and IT security in the same week
- Evidence of discovery-led adoption, not checkbox onboarding
- Strong written follow-up
- Experience with customers who host software themselves`,
  },
];

const CANDIDATES = [
  {
    email: "kavya.menon@hireos-ceo-demo.example",
    firstName: "Kavya",
    lastName: "Menon",
    phone: "+91 90000 22001",
    location: "Hyderabad",
    skills: ["Node.js", "PostgreSQL", "TypeScript", "API design"],
    experience: 7,
    summary:
      "Backend engineer who has shipped hiring-platform APIs with PostgreSQL and careful migration discipline.",
  },
  {
    email: "james.okonkwo@hireos-ceo-demo.example",
    firstName: "James",
    lastName: "Okonkwo",
    phone: "+1 415 555 2202",
    location: "Oakland, CA",
    skills: ["Node.js", "Observability", "TypeScript", "PostgreSQL"],
    experience: 5,
    summary:
      "Platform engineer focused on reliability, tracing, and keeping production incidents boring.",
  },
  {
    email: "aisha.rahman@hireos-ceo-demo.example",
    firstName: "Aisha",
    lastName: "Rahman",
    phone: "+91 90000 22003",
    location: "Bengaluru",
    skills: ["Onboarding", "Renewals", "Executive communication"],
    experience: 5,
    summary:
      "Customer success manager who leads with discovery and keeps renewal forecasts conservative.",
  },
  {
    email: "rohan.desai@hireos-ceo-demo.example",
    firstName: "Rohan",
    lastName: "Desai",
    phone: "+91 90000 22004",
    location: "Pune",
    skills: ["SQL", "Funnel metrics", "Dashboards", "People analytics"],
    experience: 4,
    summary:
      "People analyst who prefers defined metrics over decorative dashboards, especially for hiring funnels.",
  },
  {
    email: "leah.chen@hireos-ceo-demo.example",
    firstName: "Leah",
    lastName: "Chen",
    phone: "+1 206 555 2205",
    location: "Seattle, WA",
    skills: ["Onboarding", "Product feedback", "Stakeholder management"],
    experience: 4,
    summary:
      "CSM experienced in implementation programmes for operations-heavy B2B products.",
  },
  {
    email: "nathan.brooks@hireos-ceo-demo.example",
    firstName: "Nathan",
    lastName: "Brooks",
    phone: "+1 312 555 2206",
    location: "Chicago, IL",
    skills: ["SQL", "Experiment design", "Stakeholder communication"],
    experience: 3,
    summary:
      "Analyst who partners with HR operations on time-to-fill and stage-conversion questions.",
  },
];

function resumeText(c) {
  return `${c.firstName} ${c.lastName}
${c.skills.slice(0, 2).join(" / ")} · ${c.experience} years

SUMMARY
${c.summary}

SKILLS
${c.skills.join(", ")}

EXPERIENCE
Practitioner — prior employers (${Math.max(2, c.experience - 2)} yrs)
- Delivered work using ${c.skills.slice(0, 3).join(", ")}
- Collaborated with cross-functional partners on scoped releases

EDUCATION
Bachelor's degree — synthetic CEO-demo record (not a real person)

CONTACT
${c.email} · ${c.phone} · ${c.location}

DEMO_BATCH ${BATCH}
`;
}

function planFor(title, skills, interviewType) {
  const topics = [
    { name: "Role overview", why: `Baseline fit for ${title}`, targetDifficulty: 2, fromResume: false },
    ...skills.slice(0, 4).map((skill) => ({
      name: skill,
      why: `Required skill for ${title}`,
      targetDifficulty: 3,
      fromResume: false,
    })),
  ].slice(0, 6);
  return {
    topics,
    openingQuestion: {
      question: `Tell me about your experience most relevant to the ${title} role.`,
      topic: topics[0].name,
      difficulty: 2,
      competency: "Communication",
    },
    focusAreas: skills.slice(0, 6),
    interviewType,
    demoBatch: BATCH,
  };
}

const QUESTIONS = {
  backend: [
    ["API design", "How would you version a REST API for application stage changes without breaking recruiters mid-cycle?", "API design"],
    ["Data integrity", "What constraints would you put on jobs, applications, and interviews so reporting cannot drift?", "Data modeling"],
    ["Reliability", "A background evaluation job fails after two retries. What do you persist, and what do you never invent?", "Reliability"],
    ["Auth", "How do you review a change to session cookies in a staff application?", "Security"],
    ["Observability", "Which signals would you add before calling a local screening pipeline 'production-ready'?", "Observability"],
    ["Operations", "How do you run this stack if the only network allowed is the office LAN?", "Operations"],
  ],
  analyst: [
    ["Metrics", "Which hiring-funnel metrics would you trust, and which would you refuse to put on a CEO slide?", "Metrics"],
    ["SQL", "How would you detect a stage-count mismatch between the board and the application table?", "SQL"],
    ["Definitions", "SCREENING versus SHORTLISTED: how do you keep those definitions stable across recruiters?", "Definitions"],
    ["Stakeholders", "A hiring manager wants a single score for 'hire quality'. How do you respond?", "Stakeholders"],
    ["Privacy", "What do you exclude from people-analytics extracts in a self-hosted ATS?", "Privacy"],
    ["Experiments", "How would you evaluate whether AI screening is actually helping time-to-shortlist?", "Experiment design"],
  ],
  csm: [
    ["Discovery", "What do you ask in week one with an HR ops lead who just bought a self-hosted ATS?", "Discovery"],
    ["Onboarding", "How do you sequence onboarding when IT security and recruiting want different first wins?", "Onboarding"],
    ["Renewals", "What evidence would you collect 90 days in so a renewal is not a surprise?", "Renewals"],
    ["Escalation", "A customer’s interview links expire during a campus drive. How do you handle it?", "Escalation"],
    ["Feedback", "How do you take product feedback from the field without promising a roadmap?", "Product feedback"],
    ["Exec", "What does a useful QBR look like for a 40-person hiring team?", "Executive communication"],
  ],
};

const ANSWER_STRONG =
  "I would start from the operator workflow, constrain the design to what we can run locally, and write down success metrics before adding features. I would persist failures honestly, keep the recruiter as the decision-maker, and document the trade-offs.";
const ANSWER_MODERATE =
  "I have done similar work at a smaller scale. I would partner with the team, ask clarifying questions, and propose a first iteration we can measure. I am less practiced on the largest-scale version of this problem.";

async function cleanupUat() {
  const vikram = await prisma.application.findUnique({
    where: { id: VIKRAM_APP_ID },
    include: {
      candidate: { select: { email: true } },
    },
  });
  if (!vikram) {
    throw new Error(`Vikram application ${VIKRAM_APP_ID} not found — aborting`);
  }
  if (vikram.candidate.email !== "vikram.singh@logihiring.example") {
    throw new Error("Vikram application id does not match expected candidate — aborting");
  }
  if (vikram.stage !== "SELECTED" || vikram.status !== "HIRED") {
    throw new Error(
      `Vikram is ${vikram.stage}/${vikram.status}, expected SELECTED/HIRED — aborting`,
    );
  }

  const evalsDeleted = await prisma.aIEvaluation.deleteMany({
    where: {
      OR: [
        { sessionId: { in: UAT_SESSION_IDS } },
        { id: "cmsx5t8nc000f9hs4hono1b2n" },
      ],
    },
  });

  const timelineDeleted = await prisma.timelineEvent.deleteMany({
    where: {
      applicationId: VIKRAM_APP_ID,
      NOT: {
        type: { in: ["APPLICATION_CREATED", "STAGE_CHANGED", "DECISION"] },
      },
    },
  });

  const sessionsDeleted = await prisma.interviewSession.deleteMany({
    where: { id: { in: UAT_SESSION_IDS } },
  });

  const interviewsDir = path.join(STORAGE_ROOT, "interviews");
  let foldersRemoved = [];
  try {
    const live = new Set(
      (await prisma.interviewSession.findMany({ select: { id: true } })).map((s) => s.id),
    );
    live.add(R3_SESSION_ID);
    const entries = await readdir(interviewsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (live.has(ent.name)) continue;
      const abs = path.join(interviewsDir, ent.name);
      await rm(abs, { recursive: true, force: true });
      foldersRemoved.push(ent.name);
    }
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }

  const stillVikram = await prisma.application.findUnique({
    where: { id: VIKRAM_APP_ID },
    select: { stage: true, status: true },
  });
  if (stillVikram.stage !== "SELECTED" || stillVikram.status !== "HIRED") {
    throw new Error("Vikram stage/status changed during cleanup — aborting");
  }

  return {
    evalsDeleted: evalsDeleted.count,
    timelineDeleted: timelineDeleted.count,
    sessionsDeleted: sessionsDeleted.count,
    foldersRemoved,
    vikram: stillVikram,
  };
}

async function seedCeoBatch(org, recruiter, interviewer) {
  const existing = await prisma.candidate.count({
    where: { email: { endsWith: "@hireos-ceo-demo.example" } },
  });
  if (existing > 0) {
    throw new Error("CEO demo batch already present — refusing to duplicate");
  }

  const depts = {};
  for (const name of ["Engineering", "People", "Sales"]) {
    depts[name] = await prisma.department.findFirst({
      where: { organizationId: org.id, name },
    });
    if (!depts[name]) throw new Error(`Department missing: ${name}`);
  }

  const jobByKey = {};
  for (const spec of JOBS) {
    jobByKey[spec.key] = await prisma.job.create({
      data: {
        organizationId: org.id,
        departmentId: depts[spec.department].id,
        title: spec.title,
        description: spec.description,
        location: spec.location,
        experienceMin: spec.experienceMin,
        experienceMax: spec.experienceMax,
        skills: spec.skills,
        employmentType: "FULL_TIME",
        openings: 1,
        status: "OPEN",
        createdById: recruiter.id,
        createdAt: daysAgo(4),
        screeningCriteria: {
          mustHave: spec.skills.slice(0, 3),
          niceToHave: spec.skills.slice(3),
          demoBatch: BATCH,
        },
        interviewStages: [
          { key: "AI_INTERVIEW", label: "AI Interview" },
          { key: "TECH_INTERVIEW", label: "Tech Interview" },
          { key: "HR_INTERVIEW", label: "HR Interview" },
        ],
      },
    });
  }

  const candRows = {};
  for (const [i, c] of CANDIDATES.entries()) {
    candRows[c.email] = await prisma.candidate.create({
      data: {
        organizationId: org.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        location: c.location,
        skills: c.skills,
        experience: c.experience,
        summary: `${c.summary} [${BATCH}]`,
        resumeText: resumeText(c),
        education: [{ school: "Synthetic demo record", degree: "Bachelor's", batch: BATCH }],
        certifications: [],
        createdAt: daysAgo(3 - Math.min(i, 2)),
      },
    });
  }

  const pipeline = [
    {
      email: "kavya.menon@hireos-ceo-demo.example",
      job: "backend",
      stage: "AI_INTERVIEW",
      status: "ACTIVE",
      source: BATCH,
    },
    {
      email: "james.okonkwo@hireos-ceo-demo.example",
      job: "backend",
      stage: "AI_INTERVIEW",
      status: "ACTIVE",
      source: BATCH,
    },
    {
      email: "aisha.rahman@hireos-ceo-demo.example",
      job: "csm",
      stage: "SHORTLISTED",
      status: "ACTIVE",
      source: BATCH,
    },
    {
      email: "rohan.desai@hireos-ceo-demo.example",
      job: "analyst",
      stage: "SCREENING",
      status: "ACTIVE",
      source: BATCH,
    },
    {
      email: "leah.chen@hireos-ceo-demo.example",
      job: "csm",
      stage: "APPLIED",
      status: "ACTIVE",
      source: BATCH,
    },
    {
      email: "nathan.brooks@hireos-ceo-demo.example",
      job: "analyst",
      stage: "APPLIED",
      status: "ACTIVE",
      source: BATCH,
    },
  ];

  const apps = {};
  for (const [i, p] of pipeline.entries()) {
    const createdAt = daysAgo(2 - Math.min(i, 1));
    const app = await prisma.application.create({
      data: {
        candidateId: candRows[p.email].id,
        jobId: jobByKey[p.job].id,
        stage: p.stage,
        status: p.status,
        source: p.source,
        coverNote: `[${BATCH}] Interested in ${jobByKey[p.job].title} at Logi Hiring.`,
        createdAt,
        timelineEvents: {
          create: [
            {
              type: "APPLICATION_CREATED",
              payload: { source: p.source, demo: true, batch: BATCH },
              createdAt,
            },
            ...(p.stage === "APPLIED"
              ? []
              : [
                  {
                    type: "STAGE_CHANGED",
                    payload: { from: "APPLIED", to: p.stage, demo: true, batch: BATCH },
                    createdAt: new Date(createdAt.getTime() + 8 * 3600 * 1000),
                  },
                ]),
          ],
        },
      },
    });
    apps[p.email] = app;
  }

  async function addInterview({ email, jobKey, status, qCount, answerCount, evalOverall, evalRec }) {
    const app = apps[email];
    const job = jobByKey[jobKey];
    const qs = QUESTIONS[jobKey];
    const interviewType = jobKey === "csm" ? "HR" : jobKey === "analyst" ? "DATA_AI" : "TECHNICAL";
    const startedAt = status === "SCHEDULED" ? null : hoursAgo(status === "COMPLETED" ? 8 : 1);
    const endedAt = status === "COMPLETED" ? hoursAgo(6) : null;
    const session = await prisma.interviewSession.create({
      data: {
        applicationId: app.id,
        mode: "AI_ADAPTIVE",
        deliveryMode: "TEXT",
        status,
        interviewType,
        maxQuestions: 8,
        durationMinutes: 30,
        accessToken: token(),
        tokenExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        scheduledAt: hoursAgo(status === "SCHEDULED" ? -18 : 12),
        startedAt,
        endedAt,
        interviewerId: interviewer.id,
        proctoringEnabled: false,
        proctoringMode: "OFF",
        integrityMode: "STANDARD",
        plan: planFor(job.title, job.skills, interviewType),
        adaptiveState: {
          currentTopicIndex: 0,
          questionsAsked: qCount,
          followUpsOnCurrentTopic: 0,
          topicsCovered: [],
          difficulty: 3,
          concluded: status === "COMPLETED",
          demoBatch: BATCH,
        },
      },
    });
    await prisma.timelineEvent.create({
      data: {
        applicationId: app.id,
        type: status === "SCHEDULED" ? "INTERVIEW_SCHEDULED" : "INTERVIEW_STARTED",
        payload: { sessionId: session.id, demo: true, batch: BATCH, status },
      },
    });
    if (status === "COMPLETED") {
      await prisma.timelineEvent.create({
        data: {
          applicationId: app.id,
          type: "INTERVIEW_COMPLETED",
          payload: { sessionId: session.id, demo: true, batch: BATCH },
        },
      });
    }
    const tone = evalOverall && evalOverall >= 80 ? ANSWER_STRONG : ANSWER_MODERATE;
    for (let i = 0; i < qCount; i++) {
      const [topic, question, competency] = qs[i];
      const qrow = await prisma.interviewQuestion.create({
        data: {
          sessionId: session.id,
          sequence: i + 1,
          question,
          topic,
          difficulty: i < 2 ? "MEDIUM" : "HARD",
          competency,
          action: i === 0 ? "OPENING" : "GO_DEEPER",
        },
      });
      if (i < answerCount) {
        await prisma.interviewAnswer.create({
          data: {
            sessionId: session.id,
            questionId: qrow.id,
            answerText: tone,
            durationSec: 80 + i * 12,
          },
        });
      }
    }
    if (status === "COMPLETED" && evalOverall != null) {
      await prisma.aIEvaluation.create({
        data: {
          applicationId: app.id,
          sessionId: session.id,
          kind: "INTERVIEW_OVERALL",
          scores: {
            overall: evalOverall,
            dimensions: {
              technicalKnowledge: evalOverall - 1,
              problemSolving: evalOverall,
              communication: evalOverall + 2,
              roleKnowledge: evalOverall - 3,
              behavioral: evalOverall,
              confidenceClarity: evalOverall + 1,
            },
            demoBatch: BATCH,
          },
          recommendation: evalRec,
          reasoning:
            "Advisory CEO-demo evaluation only. Structured, role-relevant answers with clear communication. Recruiter remains the decision-maker; this score must not change stage automatically.",
          model: `demo-seed-${BATCH}`,
        },
      });
      await prisma.timelineEvent.create({
        data: {
          applicationId: app.id,
          type: "AI_EVALUATION",
          payload: {
            kind: "INTERVIEW_OVERALL",
            sessionId: session.id,
            demo: true,
            batch: BATCH,
            advisoryOnly: true,
            overall: evalOverall,
            recommendation: evalRec,
          },
        },
      });
    }
    return session;
  }

  const sessions = [];
  sessions.push(
    await addInterview({
      email: "kavya.menon@hireos-ceo-demo.example",
      jobKey: "backend",
      status: "COMPLETED",
      qCount: 6,
      answerCount: 6,
      evalOverall: 82,
      evalRec: "YES",
    }),
  );
  sessions.push(
    await addInterview({
      email: "james.okonkwo@hireos-ceo-demo.example",
      jobKey: "backend",
      status: "IN_PROGRESS",
      qCount: 3,
      answerCount: 1,
    }),
  );
  sessions.push(
    await addInterview({
      email: "aisha.rahman@hireos-ceo-demo.example",
      jobKey: "csm",
      status: "SCHEDULED",
      qCount: 0,
      answerCount: 0,
    }),
  );

  const rohanApp = apps["rohan.desai@hireos-ceo-demo.example"];
  const screen = await prisma.aIEvaluation.create({
    data: {
      applicationId: rohanApp.id,
      kind: "RESUME_SCREEN",
      scores: {
        overall: 74,
        skills: 78,
        experience: 70,
        why: ["SQL and funnel-metric experience match the role"],
        missing: ["Limited published dashboard examples"],
        concerns: [],
        demoBatch: BATCH,
      },
      recommendation: "MAYBE",
      reasoning:
        "Advisory CEO-demo resume screen only. Relevant analytics background; recruiter should review for People-domain depth. Must not auto-advance stage.",
      model: `demo-seed-${BATCH}`,
    },
  });
  await prisma.timelineEvent.create({
    data: {
      applicationId: rohanApp.id,
      type: "SCREENING_COMPLETED",
      payload: {
        evaluationId: screen.id,
        demo: true,
        batch: BATCH,
        advisoryOnly: true,
        overall: 74,
        recommendation: "MAYBE",
      },
    },
  });

  return { jobByKey, candRows, apps, sessions, screen };
}

async function verify() {
  const jobs = await prisma.job.count();
  const cands = await prisma.candidate.count();
  const apps = await prisma.application.count();
  const sessions = await prisma.interviewSession.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const stages = await prisma.application.groupBy({
    by: ["stage"],
    _count: { _all: true },
  });
  const vikram = await prisma.application.findUnique({
    where: { id: VIKRAM_APP_ID },
    include: {
      _count: { select: { interviewSessions: true, aiEvaluations: true } },
      candidate: { select: { email: true } },
    },
  });
  const r3FolderKeep = true;
  const orphans = [];
  try {
    const live = new Set(
      (await prisma.interviewSession.findMany({ select: { id: true } })).map((s) => s.id),
    );
    live.add(R3_SESSION_ID);
    const entries = await readdir(path.join(STORAGE_ROOT, "interviews"), { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && !live.has(ent.name)) orphans.push(ent.name);
    }
  } catch {
    /* no dir */
  }
  const ceoCands = await prisma.candidate.findMany({
    where: { email: { endsWith: "@hireos-ceo-demo.example" } },
    orderBy: { lastName: "asc" },
    include: {
      applications: {
        include: {
          job: { select: { title: true } },
          interviewSessions: { select: { id: true, status: true } },
          aiEvaluations: { select: { id: true, kind: true, recommendation: true, model: true, scores: true } },
        },
      },
    },
  });
  const ceoJobs = await prisma.job.findMany({
    where: { screeningCriteria: { path: ["demoBatch"], equals: BATCH } },
    select: { id: true, title: true, status: true },
  });
  const seedEvals = await prisma.aIEvaluation.findMany({
    where: { model: "demo-seed" },
    select: { id: true, recommendation: true },
  });
  const staff = await prisma.user.findMany({
    where: { email: { in: KEEP_STAFF } },
    select: { email: true, role: true },
  });
  const proc = await prisma.proctoringEvent.count();
  const uatLeft = await prisma.interviewSession.count({
    where: { id: { in: UAT_SESSION_IDS } },
  });

  return {
    totals: { jobs, cands, apps, proctoring: proc, staff: staff.length },
    stages,
    sessions,
    vikram: {
      email: vikram.candidate.email,
      stage: vikram.stage,
      status: vikram.status,
      sessions: vikram._count.interviewSessions,
      evals: vikram._count.aiEvaluations,
    },
    r3FolderKeep,
    orphanStorage: orphans,
    uatSessionsLeft: uatLeft,
    seedEvalCount: seedEvals.length,
    ceoJobs,
    ceoCands: ceoCands.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`,
      email: c.email,
      apps: c.applications.map((a) => ({
        id: a.id,
        job: a.job.title,
        stage: a.stage,
        sessions: a.interviewSessions,
        evals: a.aiEvaluations.map((e) => ({
          id: e.id,
          kind: e.kind,
          rec: e.recommendation,
          model: e.model,
          overall:
            e.scores && typeof e.scores === "object" && e.scores !== null && "overall" in e.scores
              ? e.scores.overall
              : null,
        })),
      })),
    })),
  };
}

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error("org acme-hiring missing");
  const recruiter = await prisma.user.findUnique({ where: { email: "recruiter@local.dev" } });
  const interviewer = await prisma.user.findUnique({ where: { email: "interviewer@local.dev" } });
  if (!recruiter || !interviewer) throw new Error("staff missing");

  const before = {
    jobs: await prisma.job.count(),
    cands: await prisma.candidate.count(),
    apps: await prisma.application.count(),
    sessions: await prisma.interviewSession.count(),
  };

  const cleanup = await cleanupUat();
  const created = await seedCeoBatch(org, recruiter, interviewer);
  const after = await verify();

  const summary = {
    cleanup,
    before,
    created: {
      jobs: Object.values(created.jobByKey).map((j) => ({ id: j.id, title: j.title })),
      candidates: Object.values(created.candRows).map((c) => ({
        id: c.id,
        email: c.email,
        name: `${c.firstName} ${c.lastName}`,
      })),
      applications: Object.entries(created.apps).map(([email, a]) => ({
        id: a.id,
        email,
        stage: a.stage,
        jobId: a.jobId,
      })),
      sessions: created.sessions.map((s) => ({
        id: s.id,
        status: s.status,
        applicationId: s.applicationId,
      })),
      screeningEvalId: created.screen.id,
    },
    verify: after,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
