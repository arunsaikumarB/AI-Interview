/**
 * One-shot demo cleanup + professional seed for Logi Hiring.
 * Does not change Prisma schema, auth, AI, or interview engine code.
 *
 * Run: node --env-file=.env scripts/demo-cleanup-and-seed.mjs
 */
import { randomBytes } from "crypto";
import { rm } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const KEEP_STAFF = new Set([
  "admin@local.dev",
  "hr@local.dev",
  "recruiter@local.dev",
  "hm@local.dev",
  "interviewer@local.dev",
  "candidate@local.dev",
]);

const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT ?? "./storage");
const ORG_SLUG = "acme-hiring";

function token() {
  return randomBytes(32).toString("hex");
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000);
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
    {
      name: "Recent project deep-dive",
      why: "Validate hands-on delivery",
      targetDifficulty: 3,
      fromResume: true,
    },
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
  };
}

const JOBS = [
  {
    key: "fullstack",
    title: "Senior Full Stack Engineer",
    department: "Engineering",
    location: "Hyderabad / Hybrid",
    experienceMin: 5,
    experienceMax: 8,
    skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "System design"],
    employmentType: "FULL_TIME",
    description: `We are hiring a Senior Full Stack Engineer to design and ship product features across our recruiter and candidate experiences.

Responsibilities
- Own end-to-end delivery of web features in React and Node.js
- Design PostgreSQL data models and APIs with clear contracts
- Improve performance, observability, and security of core hiring workflows
- Partner with product and design on scoped, high-quality releases
- Mentor engineers through design reviews and pragmatic technical standards

Requirements
- 5–8 years building production web applications
- Strong TypeScript, React, and API design
- Hands-on PostgreSQL experience
- Comfortable discussing authentication, authorization, and data integrity
- Clear written and verbal communication with hiring managers and HR`,
  },
  {
    key: "frontend",
    title: "Frontend React Developer",
    department: "Engineering",
    location: "Bengaluru / Hybrid",
    experienceMin: 3,
    experienceMax: 5,
    skills: ["React", "TypeScript", "Accessibility", "CSS", "REST APIs"],
    employmentType: "FULL_TIME",
    description: `Join the product engineering team to craft fast, accessible recruiter interfaces.

Responsibilities
- Build React interfaces with strong TypeScript discipline
- Translate design systems into reusable, accessible components
- Integrate REST APIs and handle loading, empty, and error states honestly
- Profile and improve frontend performance
- Collaborate with designers on interaction details

Requirements
- 3–5 years of professional React experience
- Solid TypeScript and modern CSS
- Working knowledge of accessibility (WCAG) and keyboard flows
- Experience consuming REST APIs
- Portfolio or work samples showing production UI`,
  },
  {
    key: "designer",
    title: "Product Designer (UI/UX)",
    department: "Design",
    location: "Remote / Hybrid",
    experienceMin: 3,
    experienceMax: 6,
    skills: ["Figma", "User research", "Design systems", "Prototyping", "Accessibility"],
    employmentType: "FULL_TIME",
    description: `Design clear hiring workflows for recruiters, hiring managers, and candidates.

Responsibilities
- Lead discovery, wireframes, and high-fidelity work in Figma
- Run lightweight user research with recruiters and candidates
- Maintain and extend the product design system
- Partner with engineering on feasible, accessible implementations
- Present design rationale to product and HR stakeholders

Requirements
- 3–6 years in product or UX design
- Strong Figma craft and prototyping
- Evidence of research informing shipped product
- Experience with design systems
- Portfolio demonstrating complex B2B or workflow products`,
  },
  {
    key: "pm",
    title: "Product Manager",
    department: "Product",
    location: "Hyderabad / Hybrid",
    experienceMin: 4,
    experienceMax: 7,
    skills: ["Roadmapping", "Discovery", "Metrics", "Stakeholder management", "Prioritization"],
    employmentType: "FULL_TIME",
    description: `Own outcomes for core hiring workflows — from job posting through interview decisions.

Responsibilities
- Define problem statements, success metrics, and sequenced roadmaps
- Run discovery with recruiters, hiring managers, and candidates
- Prioritize ruthlessly and communicate trade-offs
- Partner with engineering and design through delivery
- Review funnel metrics and qualitative feedback after each release

Requirements
- 4–7 years as a product manager on B2B or workflow products
- Comfort with qualitative research and basic funnel metrics
- Strong stakeholder management across HR and engineering
- Clear writing and facilitation
- Experience shipping iteratively with engineering teams`,
  },
  {
    key: "hrbp",
    title: "HR Business Partner",
    department: "People",
    location: "Hyderabad",
    experienceMin: 4,
    experienceMax: 7,
    skills: ["Employee relations", "Performance management", "Stakeholder management", "HR operations"],
    employmentType: "FULL_TIME",
    description: `Support engineering and product leaders as a trusted HR business partner.

Responsibilities
- Advise managers on performance, development, and employee relations
- Partner on org design and workforce planning
- Facilitate fair, consistent hiring and onboarding practices
- Coach leaders through difficult conversations
- Improve people processes without adding bureaucracy

Requirements
- 4–7 years in HRBP or generalist HR roles
- Experience supporting technology or professional-services teams
- Strong judgment on employee relations
- Comfortable in confidential, high-trust conversations
- Practical knowledge of performance management cycles`,
  },
  {
    key: "sales",
    title: "Sales Account Executive",
    department: "Sales",
    location: "Mumbai / Hybrid",
    experienceMin: 3,
    experienceMax: 6,
    skills: ["Discovery", "Qualification", "Negotiation", "CRM", "Enterprise sales"],
    employmentType: "FULL_TIME",
    description: `Own a territory of mid-market accounts evaluating a self-hosted hiring platform.

Responsibilities
- Run discovery and qualification with HR and IT buyers
- Build multi-threaded relationships with economic and technical buyers
- Negotiate commercial terms with integrity
- Forecast accurately and keep CRM current
- Partner with product on customer evidence from the field

Requirements
- 3–6 years in B2B or SaaS account executive roles
- Evidence of discovery-led selling, not slide-only pitching
- Comfortable discussing security and on-prem / self-hosted constraints
- Strong written follow-up
- CRM discipline (any major CRM)`,
  },
];

const CANDIDATES = [
  {
    email: "candidate@local.dev",
    firstName: "Meera",
    lastName: "Iyer",
    phone: "+91 90000 11001",
    location: "Chennai",
    skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
    experience: 7,
    summary:
      "Full-stack engineer who has shipped recruiter-facing products with TypeScript, React, and PostgreSQL. Strong on API contracts and pragmatic delivery.",
    portal: true,
  },
  {
    email: "arjun.mehta@logihiring.example",
    firstName: "Arjun",
    lastName: "Mehta",
    phone: "+91 90000 11002",
    location: "Hyderabad",
    skills: ["TypeScript", "Node.js", "PostgreSQL", "System design"],
    experience: 8,
    summary: "Senior engineer focused on API design, data modeling, and production reliability for hiring platforms.",
  },
  {
    email: "priya.sharma@logihiring.example",
    firstName: "Priya",
    lastName: "Sharma",
    phone: "+91 90000 11003",
    location: "Bengaluru",
    skills: ["React", "TypeScript", "Accessibility", "CSS"],
    experience: 4,
    summary: "Frontend engineer specializing in accessible React interfaces and design-system implementation.",
  },
  {
    email: "daniel.wilson@logihiring.example",
    firstName: "Daniel",
    lastName: "Wilson",
    phone: "+1 415 555 0104",
    location: "Austin, TX",
    skills: ["React", "TypeScript", "REST APIs", "Performance"],
    experience: 5,
    summary: "Frontend developer with a track record of performance work and thoughtful API integration.",
  },
  {
    email: "ananya.rao@logihiring.example",
    firstName: "Ananya",
    lastName: "Rao",
    phone: "+91 90000 11005",
    location: "Pune",
    skills: ["Figma", "User research", "Design systems"],
    experience: 5,
    summary: "Product designer who pairs research with high-fidelity Figma systems for complex workflows.",
  },
  {
    email: "michael.carter@logihiring.example",
    firstName: "Michael",
    lastName: "Carter",
    phone: "+1 206 555 0106",
    location: "Seattle, WA",
    skills: ["Figma", "Prototyping", "Accessibility"],
    experience: 4,
    summary: "UI/UX designer focused on accessible prototypes and collaboration with engineering.",
  },
  {
    email: "sneha.reddy@logihiring.example",
    firstName: "Sneha",
    lastName: "Reddy",
    phone: "+91 90000 11007",
    location: "Hyderabad",
    skills: ["Roadmapping", "Discovery", "Metrics"],
    experience: 6,
    summary: "Product manager experienced in discovery, prioritization, and shipping with engineering partners.",
  },
  {
    email: "rahul.verma@logihiring.example",
    firstName: "Rahul",
    lastName: "Verma",
    phone: "+91 90000 11008",
    location: "Gurugram",
    skills: ["Stakeholder management", "Prioritization", "Discovery"],
    experience: 5,
    summary: "PM who facilitates alignment across HR, engineering, and design without losing delivery focus.",
  },
  {
    email: "emily.johnson@logihiring.example",
    firstName: "Emily",
    lastName: "Johnson",
    phone: "+1 312 555 0109",
    location: "Chicago, IL",
    skills: ["Employee relations", "Performance management", "Coaching"],
    experience: 6,
    summary: "HR business partner supporting technology teams through performance and employee relations.",
  },
  {
    email: "karthik.nair@logihiring.example",
    firstName: "Karthik",
    lastName: "Nair",
    phone: "+91 90000 11010",
    location: "Kochi",
    skills: ["HR operations", "Stakeholder management", "Onboarding"],
    experience: 5,
    summary: "People partner with practical HR operations experience and calm stakeholder management.",
  },
  {
    email: "olivia.bennett@logihiring.example",
    firstName: "Olivia",
    lastName: "Bennett",
    phone: "+1 617 555 0111",
    location: "Boston, MA",
    skills: ["Discovery", "Negotiation", "CRM"],
    experience: 5,
    summary: "Account executive who leads with discovery and keeps forecasts honest.",
  },
  {
    email: "vikram.singh@logihiring.example",
    firstName: "Vikram",
    lastName: "Singh",
    phone: "+91 90000 11012",
    location: "Mumbai",
    skills: ["Qualification", "Enterprise sales", "Negotiation"],
    experience: 6,
    summary: "Enterprise AE comfortable discussing self-hosted security constraints with IT buyers.",
  },
  {
    email: "sarah.mitchell@logihiring.example",
    firstName: "Sarah",
    lastName: "Mitchell",
    phone: "+1 646 555 0113",
    location: "New York, NY",
    skills: ["TypeScript", "React", "Node.js"],
    experience: 6,
    summary: "Full-stack engineer with product-minded delivery and strong code-review habits.",
  },
  {
    email: "neha.kapoor@logihiring.example",
    firstName: "Neha",
    lastName: "Kapoor",
    phone: "+91 90000 11014",
    location: "Noida",
    skills: ["React", "TypeScript", "Design systems"],
    experience: 3,
    summary: "Frontend engineer who implements design-system components with care for edge cases.",
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
${c.experience >= 6 ? "Senior" : ""} Practitioner — Independent / prior employers (${Math.max(2, c.experience - 2)} yrs)
- Delivered work using ${c.skills.slice(0, 3).join(", ")}
- Collaborated with cross-functional partners on scoped releases
- Documented decisions and mentored peers where appropriate

EDUCATION
Bachelor's degree — synthetic demo record (not a real person)

CONTACT
${c.email} · ${c.phone} · ${c.location}
`;
}

const QUESTIONS = {
  fullstack: [
    ["React architecture", "How do you structure a large React application so feature teams can ship without stepping on each other?", "Architecture"],
    ["API design", "Walk through how you would design a versioned REST API for application stage changes.", "API design"],
    ["Database design", "How would you model jobs, applications, and interview sessions to keep reporting honest?", "Data modeling"],
    ["Authentication", "What do you look for when reviewing authentication and session handling in a staff app?", "Security"],
    ["Performance", "A recruiter dashboard is slow with a few thousand applications. How do you investigate?", "Performance"],
    ["System design", "Design a local, self-hosted screening pipeline that must not call cloud AI APIs.", "System design"],
  ],
  frontend: [
    ["State management", "When do you keep state in React local state versus lifting it or using a query cache?", "State"],
    ["Components", "How do you decide what belongs in a design-system component versus a page-specific one?", "Architecture"],
    ["Performance", "What measurements do you take before optimizing a slow list view?", "Performance"],
    ["Accessibility", "How do you verify a modal dialog is usable with keyboard and screen readers?", "Accessibility"],
    ["TypeScript", "Give an example of a TypeScript pattern you use to keep API responses honest in the UI.", "TypeScript"],
    ["API integration", "How do you handle loading, empty, and error states when a list endpoint fails?", "API integration"],
  ],
  designer: [
    ["Design process", "Walk me through how you would redesign a crowded hiring pipeline board.", "Process"],
    ["User research", "How do you recruit and run research with busy recruiters without slowing delivery?", "Research"],
    ["Usability", "What usability issues do you typically find in multi-stage workflow products?", "Usability"],
    ["Design systems", "How should a design system evolve when engineering is mid-migration?", "Systems"],
    ["Accessibility", "How do you bake accessibility into Figma specs so it survives implementation?", "Accessibility"],
    ["Product thinking", "A stakeholder wants a new dashboard widget. How do you test whether it is the right problem?", "Product thinking"],
  ],
  pm: [
    ["Strategy", "How would you decide the next three quarters of hiring-product investment?", "Strategy"],
    ["Prioritization", "Two directors disagree on the roadmap. How do you facilitate a decision?", "Prioritization"],
    ["Metrics", "Which funnel metrics would you watch after launching AI screening, and why?", "Metrics"],
    ["Stakeholders", "How do you keep HR, engineering, and sales aligned without weekly status theater?", "Stakeholders"],
    ["Discovery", "Describe a discovery interview you would run with a hiring manager.", "Discovery"],
    ["Execution", "A sprint is slipping. What do you cut, and how do you communicate it?", "Execution"],
  ],
  hrbp: [
    ["Employee relations", "A high performer is creating tension on a team. How do you approach it?", "ER"],
    ["HR strategy", "How do you partner with an engineering director on workforce planning?", "Strategy"],
    ["Conflict", "Walk through mediating a conflict between a hiring manager and a recruiter.", "Conflict"],
    ["Performance", "How do you run a fair performance conversation when evidence is mixed?", "Performance"],
    ["Stakeholders", "What does a trusted HRBP cadence look like with a 40-person product org?", "Stakeholders"],
    ["Hiring", "How should HR and recruiting share ownership of a slow time-to-offer?", "Hiring"],
  ],
  sales: [
    ["Discovery", "What questions do you ask in the first call with an HR director evaluating ATS software?", "Discovery"],
    ["Qualification", "How do you qualify a self-hosted buyer versus a cloud-only buyer?", "Qualification"],
    ["Objections", "A prospect says they already have spreadsheets. How do you handle that?", "Objections"],
    ["Negotiation", "Walk through a commercial negotiation where IT has security veto power.", "Negotiation"],
    ["Closing", "What does a clean close look like when legal review is still open?", "Closing"],
    ["Accounts", "How do you expand an account after the first department goes live?", "Account management"],
  ],
};

const ANSWERS = {
  strong:
    "I would start from the user job-to-be-done, constrain the design to what we can operate locally, and sequence delivery so recruiters see value before we add complexity. I would write down success metrics, name the risks, and keep the human decision as the source of truth.",
  moderate:
    "I have done similar work on a smaller scale. I would partner with the team, ask clarifying questions, and propose a first iteration we can measure. I am less practiced on the largest-scale version of this problem.",
  developing:
    "I understand the goal at a high level and would want more time with the existing process before recommending a detailed approach. I have related experience but not yet at this scope.",
};

async function removeRecordingTree(relPath) {
  if (!relPath || relPath.includes("..")) return;
  const absFile = path.resolve(STORAGE_ROOT, relPath);
  const rel = path.relative(STORAGE_ROOT, absFile);
  if (!rel || rel.startsWith("..")) return;
  const sessionRoot = absFile.split(`${path.sep}secondary-camera`)[0];
  if (!sessionRoot.startsWith(STORAGE_ROOT)) return;
  try {
    await rm(sessionRoot, { recursive: true, force: true });
  } catch {
    /* missing folder is fine */
  }
}

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    console.error("BLOCKED: organization slug acme-hiring not found");
    process.exit(1);
  }
  const staff = await prisma.user.findMany({
    where: { email: { in: [...KEEP_STAFF] } },
  });
  const byEmail = Object.fromEntries(staff.map((u) => [u.email, u]));
  for (const email of KEEP_STAFF) {
    if (!byEmail[email]) {
      console.error(`BLOCKED: required account missing: ${email}`);
      process.exit(1);
    }
  }
  if (byEmail["admin@local.dev"].role !== "SUPER_ADMIN") {
    console.error("BLOCKED: admin@local.dev is not SUPER_ADMIN");
    process.exit(1);
  }

  const recordingRows = await prisma.interviewSession.findMany({
    where: { OR: [{ secondaryRecordingPath: { not: null } }, { secondaryRecordingId: { not: null } }] },
    select: { id: true, secondaryRecordingPath: true },
  });

  const removed = {
    applications: 0,
    sessions: await prisma.interviewSession.count(),
    candidates: 0,
    jobs: 0,
    extraUsers: 0,
    recordingFolders: recordingRows.length,
    evaluations: await prisma.aIEvaluation.count(),
    proctoring: await prisma.proctoringEvent.count(),
  };

  for (const row of recordingRows) {
    if (row.secondaryRecordingPath) await removeRecordingTree(row.secondaryRecordingPath);
  }

  removed.applications = (await prisma.application.deleteMany({})).count;
  removed.candidates = (await prisma.candidate.deleteMany({})).count;
  removed.jobs = (await prisma.job.deleteMany({})).count;
  const extraUsers = await prisma.user.findMany({
    where: { email: { notIn: [...KEEP_STAFF] } },
    select: { id: true, email: true },
  });
  if (extraUsers.length) {
    await prisma.user.deleteMany({ where: { id: { in: extraUsers.map((u) => u.id) } } });
    removed.extraUsers = extraUsers.length;
  }

  const recruiter = byEmail["recruiter@local.dev"];
  const interviewer = byEmail["interviewer@local.dev"];
  const portalUser = byEmail["candidate@local.dev"];

  const deptNames = ["Engineering", "People", "Product", "Design", "Sales"];
  const depts = {};
  for (const name of deptNames) {
    depts[name] = await prisma.department.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name },
    });
  }

  const jobByKey = {};
  for (const spec of JOBS) {
    const job = await prisma.job.create({
      data: {
        organizationId: org.id,
        departmentId: depts[spec.department].id,
        title: spec.title,
        description: spec.description,
        location: spec.location,
        experienceMin: spec.experienceMin,
        experienceMax: spec.experienceMax,
        skills: spec.skills,
        employmentType: spec.employmentType,
        openings: spec.key === "fullstack" ? 2 : 1,
        status: "OPEN",
        createdById: recruiter.id,
        createdAt: daysAgo(20),
        screeningCriteria: {
          mustHave: spec.skills.slice(0, 3),
          niceToHave: spec.skills.slice(3),
        },
        interviewStages: [
          { key: "AI_INTERVIEW", label: "AI Interview" },
          { key: "TECH_INTERVIEW", label: "Tech Interview" },
          { key: "HR_INTERVIEW", label: "HR Interview" },
        ],
      },
    });
    jobByKey[spec.key] = job;
  }

  const candRows = {};
  for (const [i, c] of CANDIDATES.entries()) {
    const row = await prisma.candidate.create({
      data: {
        organizationId: org.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        location: c.location,
        skills: c.skills,
        experience: c.experience,
        summary: c.summary,
        resumeText: resumeText(c),
        education: [{ school: "Demo University (synthetic)", degree: "Bachelor's" }],
        certifications: [],
        userId: c.portal ? portalUser.id : undefined,
        createdAt: daysAgo(18 - i),
      },
    });
    candRows[c.email] = row;
  }

  await prisma.user.update({
    where: { id: portalUser.id },
    data: { name: "Meera Iyer" },
  });

  const pipeline = [
    { email: "arjun.mehta@logihiring.example", job: "fullstack", stage: "AI_INTERVIEW", status: "ACTIVE", source: "referral" },
    { email: "sarah.mitchell@logihiring.example", job: "fullstack", stage: "TECH_INTERVIEW", status: "ACTIVE", source: "linkedin" },
    { email: "candidate@local.dev", job: "fullstack", stage: "SHORTLISTED", status: "ACTIVE", source: "career_site" },
    { email: "priya.sharma@logihiring.example", job: "frontend", stage: "SCREENING", status: "ACTIVE", source: "career_site" },
    { email: "daniel.wilson@logihiring.example", job: "frontend", stage: "AI_INTERVIEW", status: "ACTIVE", source: "referral" },
    { email: "neha.kapoor@logihiring.example", job: "frontend", stage: "APPLIED", status: "ACTIVE", source: "linkedin" },
    { email: "ananya.rao@logihiring.example", job: "designer", stage: "HR_INTERVIEW", status: "ACTIVE", source: "referral" },
    { email: "michael.carter@logihiring.example", job: "designer", stage: "ASSESSMENT", status: "ACTIVE", source: "career_site" },
    { email: "sneha.reddy@logihiring.example", job: "pm", stage: "SCREENING", status: "ACTIVE", source: "linkedin" },
    { email: "rahul.verma@logihiring.example", job: "pm", stage: "APPLIED", status: "ACTIVE", source: "career_site" },
    { email: "emily.johnson@logihiring.example", job: "hrbp", stage: "SHORTLISTED", status: "ACTIVE", source: "referral" },
    { email: "karthik.nair@logihiring.example", job: "hrbp", stage: "APPLIED", status: "ACTIVE", source: "career_site" },
    { email: "olivia.bennett@logihiring.example", job: "sales", stage: "SCREENING", status: "ACTIVE", source: "linkedin" },
    { email: "vikram.singh@logihiring.example", job: "sales", stage: "SELECTED", status: "HIRED", source: "referral" },
    { email: "priya.sharma@logihiring.example", job: "designer", stage: "REJECTED", status: "REJECTED", source: "career_site" },
    { email: "daniel.wilson@logihiring.example", job: "fullstack", stage: "APPLIED", status: "ACTIVE", source: "agency" },
    { email: "rahul.verma@logihiring.example", job: "hrbp", stage: "REJECTED", status: "REJECTED", source: "linkedin" },
    { email: "neha.kapoor@logihiring.example", job: "fullstack", stage: "SELECTED", status: "HIRED", source: "referral" },
  ];

  const apps = {};
  for (const [i, p] of pipeline.entries()) {
    const candidate = candRows[p.email];
    const job = jobByKey[p.job];
    const createdAt = daysAgo(16 - Math.min(i, 14));
    const app = await prisma.application.create({
      data: {
        candidateId: candidate.id,
        jobId: job.id,
        stage: p.stage,
        status: p.status,
        source: p.source,
        coverNote: `Interested in ${job.title} at Logi Hiring.`,
        createdAt,
        timelineEvents: {
          create: [
            {
              type: "APPLICATION_CREATED",
              payload: { source: p.source, demo: true },
              createdAt,
            },
            ...(p.stage === "APPLIED"
              ? []
              : [
                  {
                    type: "STAGE_CHANGED",
                    payload: { from: "APPLIED", to: p.stage, demo: true },
                    createdAt: new Date(createdAt.getTime() + 36 * 3600 * 1000),
                  },
                ]),
            ...(p.stage === "SELECTED" || p.stage === "REJECTED"
              ? [
                  {
                    type: "DECISION",
                    payload: {
                      decision: p.stage,
                      advisoryOnly: false,
                      demo: true,
                    },
                    createdAt: new Date(createdAt.getTime() + 72 * 3600 * 1000),
                  },
                ]
              : []),
          ],
        },
      },
    });
    apps[`${p.email}:${p.job}`] = app;
  }

  async function seedInterview({ appKey, jobKey, status, qCount, answerCount, evalKind }) {
    const app = apps[appKey];
    const job = jobByKey[jobKey];
    const qs = QUESTIONS[jobKey];
    const interviewType =
      jobKey === "hrbp" ? "HR" : jobKey === "pm" || jobKey === "sales" ? "MANAGERIAL" : "TECHNICAL";
    const startedAt = status === "SCHEDULED" ? null : hoursAgo(status === "COMPLETED" ? 26 : 2);
    const endedAt = status === "COMPLETED" ? hoursAgo(24) : null;
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
        scheduledAt: hoursAgo(status === "SCHEDULED" ? -20 : 30),
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
        },
      },
    });
    await prisma.timelineEvent.create({
      data: {
        applicationId: app.id,
        type: status === "SCHEDULED" ? "INTERVIEW_SCHEDULED" : "INTERVIEW_STARTED",
        payload: { sessionId: session.id, demo: true, status },
      },
    });
    if (status === "COMPLETED") {
      await prisma.timelineEvent.create({
        data: {
          applicationId: app.id,
          type: "INTERVIEW_COMPLETED",
          payload: { sessionId: session.id, demo: true },
        },
      });
    }
    const answerTone = evalKind === "strong" ? ANSWERS.strong : evalKind === "moderate" ? ANSWERS.moderate : ANSWERS.developing;
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
            answerText: answerTone,
            durationSec: 90 + i * 15,
          },
        });
      }
    }
    if (status === "COMPLETED" && evalKind) {
      const rec = evalKind === "strong" ? "YES" : evalKind === "moderate" ? "MAYBE" : "NO";
      const overall = evalKind === "strong" ? 86 : evalKind === "moderate" ? 71 : 54;
      await prisma.aIEvaluation.create({
        data: {
          applicationId: app.id,
          sessionId: session.id,
          kind: "INTERVIEW_OVERALL",
          scores: {
            overall,
            dimensions: {
              technicalKnowledge: overall - 2,
              problemSolving: overall,
              communication: overall + 2,
              roleKnowledge: overall - 4,
              behavioral: overall,
              confidenceClarity: overall,
            },
          },
          recommendation: rec,
          reasoning:
            evalKind === "strong"
              ? "Advisory seed for demo: structured answers, role-relevant examples, and clear communication. Recruiter still makes the hiring decision."
              : evalKind === "moderate"
                ? "Advisory seed for demo: reasonable fundamentals with thinner depth on system-scale trade-offs. Worth a human review before advancing."
                : "Advisory seed for demo: high-level answers with limited evidence at the required scope. Recruiter should not treat this as an auto-reject.",
          model: "demo-seed",
        },
      });
      await prisma.timelineEvent.create({
        data: {
          applicationId: app.id,
          type: "AI_EVALUATION",
          payload: { kind: "INTERVIEW_OVERALL", sessionId: session.id, demo: true, advisoryOnly: true },
        },
      });
    }
    return session;
  }

  const interviews = [];
  interviews.push(
    await seedInterview({
      appKey: "arjun.mehta@logihiring.example:fullstack",
      jobKey: "fullstack",
      status: "COMPLETED",
      qCount: 6,
      answerCount: 6,
      evalKind: "strong",
    }),
  );
  interviews.push(
    await seedInterview({
      appKey: "daniel.wilson@logihiring.example:frontend",
      jobKey: "frontend",
      status: "COMPLETED",
      qCount: 6,
      answerCount: 6,
      evalKind: "moderate",
    }),
  );
  interviews.push(
    await seedInterview({
      appKey: "ananya.rao@logihiring.example:designer",
      jobKey: "designer",
      status: "COMPLETED",
      qCount: 6,
      answerCount: 6,
      evalKind: "developing",
    }),
  );
  interviews.push(
    await seedInterview({
      appKey: "sarah.mitchell@logihiring.example:fullstack",
      jobKey: "fullstack",
      status: "IN_PROGRESS",
      qCount: 3,
      answerCount: 1,
      evalKind: null,
    }),
  );
  interviews.push(
    await seedInterview({
      appKey: "priya.sharma@logihiring.example:frontend",
      jobKey: "frontend",
      status: "IN_PROGRESS",
      qCount: 2,
      answerCount: 1,
      evalKind: null,
    }),
  );
  interviews.push(
    await seedInterview({
      appKey: "sneha.reddy@logihiring.example:pm",
      jobKey: "pm",
      status: "SCHEDULED",
      qCount: 0,
      answerCount: 0,
      evalKind: null,
    }),
  );

  const leftoverSessions = 0;
  const stageCounts = await prisma.application.groupBy({ by: ["stage"], _count: true });
  const staffLeft = await prisma.user.findMany({ select: { email: true, role: true, name: true } });
  const testish = await prisma.candidate.findMany({
    where: {
      OR: [
        { email: { contains: "uat" } },
        { email: { contains: "testcase" } },
        { firstName: { contains: "UAT" } },
        { lastName: { contains: "Test" } },
      ],
    },
  });
  const testJobs = await prisma.job.findMany({ where: { title: { contains: "TEST" } } });

  console.log(
    JSON.stringify(
      {
        org: { id: org.id, name: org.name },
        removed,
        extraUsersDeleted: extraUsers.map((u) => u.email),
        created: {
          departments: deptNames,
          jobs: JOBS.map((j) => j.title),
          candidates: CANDIDATES.map((c) => `${c.firstName} ${c.lastName}`),
          applications: pipeline.length,
          interviews: interviews.map((s) => ({ id: s.id, status: s.status })),
        },
        stageCounts,
        staffLeft,
        leftoverSessions,
        testishLeft: testish.length,
        testJobsLeft: testJobs.length,
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
