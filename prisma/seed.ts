import {
  PrismaClient,
  Role,
  PipelineStage,
  type ApplicationStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const STAGES: PipelineStage[] = [
  "APPLIED",
  "SCREENING",
  "SHORTLISTED",
  "ASSESSMENT",
  "AI_INTERVIEW",
  "TECH_INTERVIEW",
  "HR_INTERVIEW",
  "SELECTED",
  "REJECTED",
  "APPLIED",
];

function resumeFor(name: string, skills: string[], years: number) {
  const skillSet = new Set(skills.map((s) => s.toLowerCase()));
  const isDesigner =
    skillSet.has("figma") ||
    skillSet.has("ux research") ||
    skillSet.has("design systems");
  const isPlatform =
    skillSet.has("docker") ||
    skillSet.has("linux") ||
    (skillSet.has("postgresql") && skillSet.has("docker"));

  if (isDesigner) {
    return `${name}
Product Designer · ${years} years experience

SUMMARY
Product designer specializing in Figma, design systems, and UX research. Ships high-fidelity prototypes and accessible UI patterns for hiring and SaaS products.

SKILLS
${skills.join(", ")}

EXPERIENCE
Senior Product Designer — Studio North (${Math.max(1, years - 2)} yrs)
- Owned end-to-end product design in Figma with reusable design systems
- Ran UX research sessions and synthesized insights into prototypes
- Partnered with engineers on interaction details and accessibility

EDUCATION
B.A. Interaction Design
`;
  }

  if (isPlatform) {
    return `${name}
Platform / Infrastructure Engineer · ${years} years experience

SUMMARY
Platform engineer focused on Docker, PostgreSQL, and Linux. Builds reliable containerized platforms, database operations, and developer tooling for production systems.

SKILLS
${skills.join(", ")}

EXPERIENCE
Platform Engineer — Infra Labs (${Math.max(1, years - 2)} yrs)
- Operated PostgreSQL clusters and Docker-based deployment pipelines
- Hardened Linux hosts and automated platform provisioning
- Improved reliability for internal platform services used by product teams

EDUCATION
B.S. Computer Science
`;
  }

  return `${name}
Software Engineer · ${years} years experience

SUMMARY
Software engineer focused on ${skills.slice(0, 3).join(", ")}. Builds product features with strong TypeScript fundamentals and pragmatic delivery.

SKILLS
${skills.join(", ")}

EXPERIENCE
Senior Engineer — Example Corp (${Math.max(1, years - 2)} yrs)
- Delivered product features using ${skills.slice(0, 2).join(" and ")}
- Collaborated with platform and design partners on shipping quality
- Mentored juniors on testing and code review

EDUCATION
B.S. Computer Science
`;
}

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "acme-hiring" },
    update: { name: "Logi Hiring", companyName: "Logi Hiring" },
    create: { name: "Logi Hiring", slug: "acme-hiring", companyName: "Logi Hiring" },
  });

  const engineering = await prisma.department.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Engineering" } },
    update: {},
    create: { organizationId: org.id, name: "Engineering" },
  });

  const people = await prisma.department.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "People" } },
    update: {},
    create: { organizationId: org.id, name: "People" },
  });

  const staff: { email: string; name: string; role: Role; departmentId: string }[] = [
    { email: "admin@local.dev", name: "Super Admin", role: "SUPER_ADMIN", departmentId: people.id },
    { email: "hr@local.dev", name: "HR Admin", role: "HR_ADMIN", departmentId: people.id },
    {
      email: "recruiter@local.dev",
      name: "Recruiter Reese",
      role: "RECRUITER",
      departmentId: people.id,
    },
    {
      email: "hm@local.dev",
      name: "Hiring Manager",
      role: "HIRING_MANAGER",
      departmentId: engineering.id,
    },
    {
      email: "interviewer@local.dev",
      name: "Tech Interviewer",
      role: "INTERVIEWER",
      departmentId: engineering.id,
    },
    {
      email: "candidate@local.dev",
      name: "Casey Candidate",
      role: "CANDIDATE",
      departmentId: engineering.id,
    },
  ];

  const passwordHash = await bcrypt.hash("password123", 12);

  for (const u of staff) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        passwordHash,
        organizationId: org.id,
        departmentId: u.role === "CANDIDATE" ? null : u.departmentId,
        isActive: true,
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
        organizationId: org.id,
        departmentId: u.role === "CANDIDATE" ? null : u.departmentId,
      },
    });
  }

  const recruiter = await prisma.user.findUniqueOrThrow({
    where: { email: "recruiter@local.dev" },
  });
  const candidateUser = await prisma.user.findUniqueOrThrow({
    where: { email: "candidate@local.dev" },
  });

  const jobsSpec = [
    {
      id: "seed-fullstack-engineer",
      title: "Full-Stack Engineer",
      skills: ["TypeScript", "Next.js", "PostgreSQL", "Prisma"],
      description:
        "Build our self-hosted Logisoft HireOS. Own Next.js features, Prisma models, and Ollama-backed screening.",
      mustHave: ["TypeScript", "Next.js App Router", "PostgreSQL"],
      niceToHave: ["Ollama", "pgvector"],
    },
    {
      id: "seed-platform-engineer",
      title: "Platform Engineer",
      skills: ["Docker", "PostgreSQL", "CI", "Linux"],
      description:
        "Operate local infrastructure for ATS: Postgres/pgvector, storage, and deployment scripts.",
      mustHave: ["Docker", "PostgreSQL", "Linux"],
      niceToHave: ["Kubernetes", "Observability"],
    },
    {
      id: "seed-product-designer",
      title: "Product Designer",
      skills: ["Figma", "UX Research", "Design Systems"],
      description:
        "Design recruiter and candidate experiences for a complex hiring pipeline product.",
      mustHave: ["Figma", "UX Research"],
      niceToHave: ["Motion design", "Design systems"],
    },
  ];

  for (const j of jobsSpec) {
    await prisma.job.upsert({
      where: { id: j.id },
      update: {
        title: j.title,
        description: j.description,
        skills: j.skills,
        status: "OPEN",
        organizationId: org.id,
        departmentId: engineering.id,
        experienceMin: 2,
        experienceMax: 8,
        screeningCriteria: { mustHave: j.mustHave, niceToHave: j.niceToHave },
      },
      create: {
        id: j.id,
        organizationId: org.id,
        departmentId: engineering.id,
        title: j.title,
        description: j.description,
        skills: j.skills,
        location: "Remote / Hybrid",
        experienceMin: 2,
        experienceMax: 8,
        status: "OPEN",
        openings: 2,
        createdById: recruiter.id,
        screeningCriteria: { mustHave: j.mustHave, niceToHave: j.niceToHave },
        interviewStages: [
          { key: "AI_INTERVIEW", label: "AI Interview" },
          { key: "TECH_INTERVIEW", label: "Tech Interview" },
        ],
      },
    });
  }

  const candidateSeeds: {
    email: string;
    firstName: string;
    lastName: string;
    skills: string[];
    experience: number;
    userId?: string;
  }[] = [
    {
      email: "candidate@local.dev",
      firstName: "Casey",
      lastName: "Candidate",
      userId: candidateUser.id,
      skills: ["TypeScript", "React", "PostgreSQL"],
      experience: 4,
    },
    {
      email: "alex@example.com",
      firstName: "Alex",
      lastName: "Ng",
      skills: ["TypeScript", "Next.js", "Prisma"],
      experience: 5,
    },
    {
      email: "blair@example.com",
      firstName: "Blair",
      lastName: "Singh",
      skills: ["Docker", "PostgreSQL", "Linux"],
      experience: 6,
    },
    {
      email: "cameron@example.com",
      firstName: "Cameron",
      lastName: "Ortiz",
      skills: ["Figma", "UX Research"],
      experience: 3,
    },
    {
      email: "devon@example.com",
      firstName: "Devon",
      lastName: "Park",
      skills: ["TypeScript", "Node.js"],
      experience: 2,
    },
    {
      email: "eden@example.com",
      firstName: "Eden",
      lastName: "Zhou",
      skills: ["React", "GraphQL", "PostgreSQL"],
      experience: 7,
    },
    {
      email: "finley@example.com",
      firstName: "Finley",
      lastName: "Adams",
      skills: ["Java", "Spring", "Kafka"],
      experience: 8,
    },
    {
      email: "gray@example.com",
      firstName: "Gray",
      lastName: "Ibrahim",
      skills: ["Next.js", "Tailwind", "TypeScript"],
      experience: 3,
    },
    {
      email: "harper@example.com",
      firstName: "Harper",
      lastName: "Cole",
      skills: ["Python", "FastAPI", "Postgres"],
      experience: 4,
    },
    {
      email: "indigo@example.com",
      firstName: "Indigo",
      lastName: "Reyes",
      skills: ["Figma", "Design Systems", "Prototyping"],
      experience: 5,
    },
  ];

  const jobIds = jobsSpec.map((j) => j.id);
  const createdCandidates: { id: string; email: string }[] = [];

  for (const c of candidateSeeds) {
    const resumeText = resumeFor(
      `${c.firstName} ${c.lastName}`,
      c.skills,
      c.experience,
    );
    const row = await prisma.candidate.upsert({
      where: {
        organizationId_email: { organizationId: org.id, email: c.email },
      },
      update: {
        firstName: c.firstName,
        lastName: c.lastName,
        skills: c.skills,
        experience: c.experience,
        resumeText,
        summary: `${c.firstName} is a practitioner with ${c.experience} years in ${c.skills.slice(0, 2).join(" & ")}.`,
        ...(c.userId ? { userId: c.userId } : {}),
      },
      create: {
        organizationId: org.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        skills: c.skills,
        experience: c.experience,
        resumeText,
        location: "Remote",
        summary: `${c.firstName} is a practitioner with ${c.experience} years in ${c.skills.slice(0, 2).join(" & ")}.`,
        education: [{ school: "State University", degree: "B.S. CS" }],
        certifications: [],
        ...(c.userId ? { userId: c.userId } : {}),
      },
    });
    createdCandidates.push({ id: row.id, email: row.email });
  }

  for (let i = 0; i < createdCandidates.length; i++) {
    const candidate = createdCandidates[i];
    const jobId = jobIds[i % jobIds.length];
    const stage = STAGES[i];
    const status: ApplicationStatus =
      stage === "SELECTED" ? "HIRED" : stage === "REJECTED" ? "REJECTED" : "ACTIVE";

    await prisma.application.upsert({
      where: {
        candidateId_jobId: { candidateId: candidate.id, jobId },
      },
      update: { stage, status },
      create: {
        candidateId: candidate.id,
        jobId,
        stage,
        status,
        source: i % 2 === 0 ? "career_site" : "referral",
        coverNote: "Interested in joining Logi Hiring.",
        timelineEvents: {
          create: {
            type: "APPLICATION_CREATED",
            payload: { seed: true, stage },
          },
        },
      },
    });
  }

  // Seed interview overall scores for talent-filter verification.
  // Only Alex qualifies for "interview ≥ 80".
  const alex = createdCandidates.find((c) => c.email === "alex@example.com");
  const finley = createdCandidates.find((c) => c.email === "finley@example.com");
  if (alex) {
    const app = await prisma.application.findFirst({
      where: { candidateId: alex.id },
    });
    if (app) {
      await prisma.aIEvaluation.deleteMany({
        where: { applicationId: app.id, kind: "INTERVIEW_OVERALL" },
      });
      await prisma.aIEvaluation.create({
        data: {
          applicationId: app.id,
          kind: "INTERVIEW_OVERALL",
          scores: {
            overall: 86,
            dimensions: {
              technicalKnowledge: 88,
              problemSolving: 84,
              communication: 80,
              roleKnowledge: 85,
              behavioral: 82,
              confidenceClarity: 86,
            },
          },
          recommendation: "YES",
          reasoning: "Seed interview evaluation for talent-pool filter tests.",
          model: "seed",
        },
      });
    }
  }
  if (finley) {
    const app = await prisma.application.findFirst({
      where: { candidateId: finley.id },
    });
    if (app) {
      await prisma.aIEvaluation.deleteMany({
        where: { applicationId: app.id, kind: "INTERVIEW_OVERALL" },
      });
      await prisma.aIEvaluation.create({
        data: {
          applicationId: app.id,
          kind: "INTERVIEW_OVERALL",
          scores: { overall: 72 },
          recommendation: "MAYBE",
          reasoning: "Seed below-threshold interview score.",
          model: "seed",
        },
      });
    }
  }

  // Default email templates (skip category if org already has one)
  const defaultTemplates: {
    category: string;
    name: string;
    subject: string;
    body: string;
  }[] = [
    {
      category: "application_received",
      name: "Application received",
      subject: "We received your application for {{jobTitle}}",
      body: `Hi {{candidateFirstName}},

Thank you for applying to {{jobTitle}} at {{companyName}}. Our team is reviewing your application and will be in touch with next steps.

Best regards,
{{recruiterName}}
{{companyName}}`,
    },
    {
      category: "shortlisted",
      name: "Shortlisted",
      subject: "Update on your {{jobTitle}} application",
      body: `Hi {{candidateFirstName}},

Good news — you have been shortlisted for {{jobTitle}} at {{companyName}}. We will follow up shortly with interview details.

Best regards,
{{recruiterName}}`,
    },
    {
      category: "interview_invite",
      name: "Interview invite",
      subject: "Interview invitation — {{jobTitle}} at {{companyName}}",
      body: `Hi {{candidateFirstName}},

We would like to invite you to interview for {{jobTitle}} at {{companyName}}.

Please use this link to start when you are ready:
{{interviewLink}}

If you have any questions, reply to this email.

Best regards,
{{recruiterName}}`,
    },
    {
      category: "interview_reminder",
      name: "Interview reminder",
      subject: "Reminder: your interview for {{jobTitle}}",
      body: `Hi {{candidateFirstName}},

This is a friendly reminder about your interview for {{jobTitle}} at {{companyName}}.

Interview link:
{{interviewLink}}

Best regards,
{{recruiterName}}`,
    },
    {
      category: "next_round",
      name: "Next round",
      subject: "Next steps for {{jobTitle}}",
      body: `Hi {{candidateFirstName}},

Thank you for your interview. We would like to move forward to the next round for {{jobTitle}} at {{companyName}}. We will share scheduling details soon.

Best regards,
{{recruiterName}}`,
    },
    {
      category: "rejection",
      name: "Rejection",
      subject: "Update on your {{jobTitle}} application",
      body: `Hi {{candidateFirstName}},

Thank you for your interest in {{jobTitle}} at {{companyName}} and for the time you invested in our process. After careful consideration, we will not be moving forward at this time.

We wish you the best in your search.

Best regards,
{{recruiterName}}`,
    },
    {
      category: "offer",
      name: "Offer",
      subject: "Offer — {{jobTitle}} at {{companyName}}",
      body: `Hi {{candidateFirstName}},

We are pleased to share that we would like to extend an offer for {{jobTitle}} at {{companyName}}. A member of our team will follow up with details.

Congratulations,
{{recruiterName}}`,
    },
    {
      category: "custom",
      name: "Custom blank",
      subject: "Regarding {{jobTitle}} at {{companyName}}",
      body: `Hi {{candidateFirstName}},

[Write your message here]

Best regards,
{{recruiterName}}`,
    },
  ];

  for (const t of defaultTemplates) {
    const exists = await prisma.emailTemplate.findFirst({
      where: { organizationId: org.id, category: t.category },
    });
    if (exists) continue;
    await prisma.emailTemplate.create({
      data: {
        organizationId: org.id,
        name: t.name,
        category: t.category,
        subject: t.subject,
        body: t.body,
      },
    });
  }

  console.log("Seed complete.");
  console.log(`Org: ${org.name}`);
  console.log("Users: one per role — password123");
  console.log("Jobs: 3 · Candidates: 10 across pipeline stages");
  console.log("Login: recruiter@local.dev / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
