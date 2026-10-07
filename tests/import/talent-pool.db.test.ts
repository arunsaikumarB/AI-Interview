/**
 * Talent Pool search, Add to Hiring and the Resume Parser record boundary against a THROWAWAY
 * database. Never point this at a real one.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/talent-pool.db.test.ts
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

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `tp${Date.now()}`;
const NOW = new Date(Date.UTC(2026, 9, 5, 12));

type Browse = typeof import("../../src/lib/talent/browse");
type Hiring = typeof import("../../src/lib/hiring/add-to-hiring");
type Integration = typeof import("../../src/lib/integrations/resume-parser");
type Filter = typeof import("../../src/lib/hiring/pipeline-filter");
let browse: Browse;
let hiring: Hiring;
let rp: Integration;
let filter: Filter;

let orgId: string;
let otherOrgId: string;
let perfOrgId: string;
let volumeOrgId: string;
let userId: string;
const jobs: Record<string, string> = {};
const ids: Record<string, string> = {};

const email = (who: string) => `${who}.${tag}@example.com`;

const records = [
  { externalId: `S1-${tag}`, fullName: "Seetharam Reddy", email: email("seetharam"), jobRole: ".NET Developer", experienceYears: 4.6, appliedAt: "2023-05-10" },
  { externalId: `R1-${tag}`, fullName: "Ravi Kumar", email: email("ravi"), jobRole: ".NET Developer", experienceYears: 5.2, appliedAt: "2024-03-15" },
  { externalId: `A1-${tag}`, fullName: "Anil Varma", email: email("anil"), jobRole: "QA Engineer", experienceYears: 6, appliedAt: "2024-03-20" },
  { externalId: `A2-${tag}`, fullName: "Anil Varma", email: email("anil"), jobRole: ".NET Developer", experienceYears: 6, appliedAt: "2022-11-02" },
  { externalId: `P1-${tag}`, fullName: "Priya Nair", email: email("priya"), jobRole: ".NET Developer", experienceYears: 2, appliedAt: "2024-07-01T09:30:00Z" },
];

const f = (over: Record<string, unknown> = {}) => browse.talentFiltersSchema.parse(over);
const names = async (over: Record<string, unknown> = {}, org = orgId) =>
  (await browse.browseTalent(prisma, org, f(over))).rows.map((r) => r.name).sort();

before(async () => {
  [browse, hiring, rp, filter] = await Promise.all([
    import("../../src/lib/talent/browse"),
    import("../../src/lib/hiring/add-to-hiring"),
    import("../../src/lib/integrations/resume-parser"),
    import("../../src/lib/hiring/pipeline-filter"),
  ]);
  const [org, other, perf] = await Promise.all([
    prisma.organization.create({ data: { name: `TP ${tag}`, slug: tag } }),
    prisma.organization.create({ data: { name: `TP other ${tag}`, slug: `${tag}-other` } }),
    prisma.organization.create({ data: { name: `TP perf ${tag}`, slug: `${tag}-perf` } }),
  ]);
  orgId = org.id;
  otherOrgId = other.id;
  perfOrgId = perf.id;
  userId = (await prisma.user.create({ data: { email: email("hr"), passwordHash: "x", name: "HR", role: "HR_ADMIN", organizationId: orgId } })).id;
  const job = async (key: string, title: string, status: "OPEN" | "PAUSED" | "DRAFT" | "CLOSED", org = orgId) => {
    jobs[key] = (
      await prisma.job.create({ data: { organizationId: org, title, description: "d", location: "Hyderabad", status, createdById: userId } })
    ).id;
  };
  await job("netOpen", ".NET Developer", "OPEN");
  await job("paused", "Paused Role", "PAUSED");
  await job("draft", "Draft Role", "DRAFT");
  await job("closed2024", ".NET Developer", "CLOSED");
  await job("otherOrgOpen", ".NET Developer", "OPEN", otherOrgId);

  const report = await rp.importResumeParserRecords({
    prisma,
    organizationId: orgId,
    userId,
    records: [...records, { externalId: "bad", fullName: "No Email", jobRole: "QA" }, { ...records[0], unexpected: "field" }],
    apply: true,
    now: NOW,
  });
  assert.equal(report.invalidRecords, 2);
  assert.equal(report.applicationsNew, 5);
  assert.equal(report.candidatesNew, 4);
  assert.equal(report.jobsNew, 1, "QA Engineer; .NET history reuses the Closed 2024 job");

  for (const who of ["seetharam", "ravi", "anil", "priya"]) {
    ids[who] = (await prisma.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: email(who) } })).id;
  }
  ids.uploaded = (
    await prisma.candidate.create({
      data: { organizationId: orgId, email: email("upload"), firstName: "Uma", lastName: "Upload", skills: ["C#", "SQL Server"], experience: 3, createdAt: new Date(Date.UTC(2025, 1, 10, 12)) },
    })
  ).id;
  ids.careers = (
    await prisma.candidate.create({
      data: {
        organizationId: orgId,
        email: email("careers"),
        firstName: "Kavya",
        lastName: "Careers",
        experience: 1,
        applications: { create: { jobId: jobs.netOpen, stage: "SCREENING", status: "ACTIVE", source: "careers_site" } },
      },
    })
  ).id;
  ids.other = (
    await prisma.candidate.create({
      data: {
        organizationId: otherOrgId,
        email: email("seetharam"),
        firstName: "Seetharam",
        lastName: "OtherOrg",
        experience: 9,
        applications: { create: { jobId: jobs.otherOrgOpen, stage: "APPLIED", status: "ACTIVE", source: "careers_site" } },
      },
    })
  ).id;
});

after(async () => {
  const orgs = [orgId, otherOrgId, perfOrgId, volumeOrgId].filter(Boolean);
  await prisma.job.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.candidate.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${tag}@example.com` } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
});

describe("Talent Pool vs Candidates", () => {
  it("historical and uploaded-only people exist without an active application and stay out of Candidates", async () => {
    const inHiring = await prisma.candidate.findMany({
      where: { organizationId: orgId, ...filter.IN_HIRING_CANDIDATE_FILTER },
      select: { id: true },
    });
    assert.deepEqual(inHiring.map((c) => c.id), [ids.careers]);
    assert.equal(await prisma.application.count({ where: { candidateId: ids.uploaded } }), 0, "no fake application");
    const seetharamApps = await prisma.application.findMany({ where: { candidateId: ids.seetharam }, include: { job: true } });
    assert.equal(seetharamApps.length, 1);
    assert.equal(seetharamApps[0].jobId, jobs.closed2024, "history kept on the Closed opening, never the open one");
    assert.equal(seetharamApps[0].status, "ON_HOLD");
  });

  it("importing into the Talent Pool runs no AI and creates no interview or assessment", async () => {
    const where = { application: { job: { organizationId: orgId } } };
    assert.equal(await prisma.aIEvaluation.count({ where }), 0);
    assert.equal(await prisma.interviewSession.count({ where }), 0);
    assert.equal(await prisma.practicalAssessment.count({ where }), 0);
  });
});

describe("Talent Pool search", () => {
  it("everyone in the organization by default, newest first, never another organization", async () => {
    const all = await names();
    assert.equal(all.length, 6);
    assert.ok(!all.includes("Seetharam OtherOrg"));
    assert.deepEqual(await names({}, otherOrgId), ["Seetharam OtherOrg"]);
  });

  it("name and email search", async () => {
    assert.deepEqual(await names({ q: "seeth" }), ["Seetharam Reddy"]);
    assert.deepEqual(await names({ q: "ravi kumar" }), ["Ravi Kumar"]);
    assert.deepEqual(await names({ q: `priya.${tag}` }), ["Priya Nair"]);
    assert.deepEqual(await names({ q: "100%_" }), [], "LIKE wildcards are matched literally");
  });

  it("role search matches any application's job title", async () => {
    assert.deepEqual(await names({ role: ".net" }), ["Anil Varma", "Kavya Careers", "Priya Nair", "Ravi Kumar", "Seetharam Reddy"]);
    assert.deepEqual(await names({ role: "qa engineer" }), ["Anil Varma"]);
  });

  it("experience range", async () => {
    assert.deepEqual(await names({ minExp: "4" }), ["Anil Varma", "Ravi Kumar", "Seetharam Reddy"]);
    assert.deepEqual(await names({ minExp: 2, maxExp: 3 }), ["Priya Nair", "Uma Upload"]);
  });

  it("year and month of application (profiles without a job use the date they were added)", async () => {
    assert.deepEqual(await names({ year: 2024 }), ["Anil Varma", "Priya Nair", "Ravi Kumar"]);
    assert.deepEqual(await names({ year: 2024, month: 3 }), ["Anil Varma", "Ravi Kumar"]);
    assert.deepEqual(await names({ year: 2025, month: 2 }), ["Uma Upload"]);
  });

  it("combined filters use AND, and role + date must match the same application", async () => {
    assert.deepEqual(await names({ role: ".NET Developer", minExp: 4, year: 2023 }), ["Seetharam Reddy"]);
    assert.deepEqual(await names({ role: ".net", year: 2024 }), ["Priya Nair", "Ravi Kumar"], "Anil's 2024 application was QA, his .NET one 2022");
    assert.deepEqual(await names({ role: ".net", year: 2022 }), ["Anil Varma"]);
    assert.deepEqual(await names({ q: "ravi", year: 2023 }), []);
  });

  it("skills and source filters", async () => {
    assert.deepEqual(await names({ skills: "c#, sql" }), ["Uma Upload"]);
    assert.deepEqual(await names({ skills: "c#, java" }), []);
    assert.deepEqual(await names({ source: "resume_parser" }), ["Anil Varma", "Priya Nair", "Ravi Kumar", "Seetharam Reddy"]);
    assert.deepEqual(await names({ source: "no_application" }), ["Uma Upload"]);
    assert.deepEqual(await names({ source: "careers_site" }), ["Kavya Careers"]);
    assert.deepEqual(await names({ source: "no_application", role: ".net" }), []);
  });

  it("hiring status filter and badges", async () => {
    assert.deepEqual(await names({ hiring: "in_hiring" }), ["Kavya Careers"]);
    assert.equal((await names({ hiring: "not_in_hiring" })).length, 5);
    const page = await browse.browseTalent(prisma, orgId, f({ q: "seetharam" }));
    const [row] = page.rows;
    assert.equal(row.inHiring, null);
    assert.deepEqual(row.applications.map((a) => [a.jobTitle, a.jobClosed, a.appliedAt.slice(0, 10)]), [[".NET Developer", true, "2023-05-10"]]);
    assert.deepEqual(row.sources, ["resume_parser"]);
    assert.deepEqual(
      Object.keys(row).sort(),
      ["addedAt", "applications", "email", "experience", "hasResume", "id", "inHiring", "location", "name", "skills", "sources"],
      "no phone, resume text or embedding leaves the server",
    );
  });

  it("server-side pagination: 25 per page, total, last page clamps", async () => {
    await prisma.candidate.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        organizationId: perfOrgId,
        email: `p${i}.${tag}@example.com`,
        firstName: `Person${String(i).padStart(2, "0")}`,
        lastName: "Perf",
        experience: i % 10,
        createdAt: new Date(Date.UTC(2024, 0, 1 + i)),
      })),
    });
    const p1 = await browse.browseTalent(prisma, perfOrgId, f());
    assert.equal(p1.total, 60);
    assert.equal(p1.pageCount, 3);
    assert.equal(p1.rows.length, 25);
    assert.equal(p1.rows[0].name, "Person59 Perf", "newest first");
    const p3 = await browse.browseTalent(prisma, perfOrgId, f({ page: 3 }));
    assert.equal(p3.rows.length, 10);
    const beyond = await browse.browseTalent(prisma, perfOrgId, f({ page: 99 }));
    assert.equal(beyond.page, 3);
    const seen = new Set([...p1.rows, ...(await browse.browseTalent(prisma, perfOrgId, f({ page: 2 }))).rows, ...p3.rows].map((r) => r.id));
    assert.equal(seen.size, 60, "pages do not overlap");
  });

  it("rejects malformed filters", () => {
    for (const bad of [
      { month: 3 },
      { minExp: 5, maxExp: 2 },
      { source: "linkedin" },
      { hiring: "maybe" },
      { page: 0 },
      { year: 1800 },
      { q: "x".repeat(101) },
      { organizationId: otherOrgId },
      { minExp: "abc" },
    ]) {
      assert.equal(browse.talentFiltersSchema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });
});

describe("Add to Hiring", () => {
  it("puts a historical candidate into a current open opening; history is preserved", async () => {
    const historyBefore = await prisma.application.findFirstOrThrow({ where: { candidateId: ids.seetharam } });
    const r = await hiring.addToHiring(prisma, { organizationId: orgId, candidateId: ids.seetharam, jobId: jobs.netOpen });
    assert.equal(r.kind, "added");
    if (r.kind !== "added") return;
    assert.equal(r.reopenedImport, false);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: r.applicationId }, include: { timelineEvents: true } });
    assert.equal(app.jobId, jobs.netOpen);
    assert.equal(app.stage, "APPLIED");
    assert.equal(app.status, "ACTIVE");
    assert.equal(app.source, "added_by_staff");
    assert.deepEqual(app.timelineEvents.map((t) => t.type), ["APPLICATION_CREATED"]);
    assert.deepEqual(await prisma.application.findUniqueOrThrow({ where: { id: historyBefore.id } }), historyBefore);

    const inHiring = await prisma.candidate.count({ where: { id: ids.seetharam, ...filter.IN_HIRING_CANDIDATE_FILTER } });
    assert.equal(inHiring, 1, "now appears in Candidates");
    const [row] = (await browse.browseTalent(prisma, orgId, f({ q: "seetharam" }))).rows;
    assert.equal(row.inHiring?.jobTitle, ".NET Developer");
  });

  it("does not run AI or create an interview or assessment", async () => {
    const where = { application: { candidateId: ids.seetharam } };
    assert.equal(await prisma.aIEvaluation.count({ where }), 0);
    assert.equal(await prisma.interviewSession.count({ where }), 0);
    assert.equal(await prisma.practicalAssessment.count({ where }), 0);
    assert.equal(await prisma.candidateAssessmentLink.count({ where }), 0);
  });

  it("the same opening twice is refused; still one application", async () => {
    const r = await hiring.addToHiring(prisma, { organizationId: orgId, candidateId: ids.seetharam, jobId: jobs.netOpen });
    assert.equal(r.kind, "already_in_job");
    assert.equal(await prisma.application.count({ where: { candidateId: ids.seetharam, jobId: jobs.netOpen } }), 1);
  });

  it("only OPEN openings of the same organization; candidate must be in the organization", async () => {
    for (const jobId of [jobs.paused, jobs.draft, jobs.closed2024, jobs.otherOrgOpen, "nope"]) {
      const r = await hiring.addToHiring(prisma, { organizationId: orgId, candidateId: ids.ravi, jobId });
      assert.equal(r.kind, "job_not_open", jobId);
    }
    const cross = await hiring.addToHiring(prisma, { organizationId: orgId, candidateId: ids.other, jobId: jobs.netOpen });
    assert.equal(cross.kind, "candidate_not_found");
    assert.equal(await prisma.application.count({ where: { candidateId: ids.ravi } }), 1);
    assert.equal(await prisma.application.count({ where: { candidateId: ids.other } }), 1);
  });

  it("an untouched import sitting on an open job (older imports) is reopened, not duplicated", async () => {
    const legacy = await prisma.application.create({
      data: {
        candidateId: ids.priya,
        jobId: jobs.netOpen,
        stage: "APPLIED",
        status: "ON_HOLD",
        source: "resume_parser",
        createdAt: new Date(Date.UTC(2024, 6, 1, 12)),
      },
    });
    const r = await hiring.addToHiring(prisma, { organizationId: orgId, candidateId: ids.priya, jobId: jobs.netOpen });
    assert.deepEqual(r, { kind: "added", applicationId: legacy.id, reopenedImport: true });
    const after = await prisma.application.findUniqueOrThrow({ where: { id: legacy.id }, include: { timelineEvents: true } });
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.stage, "APPLIED");
    assert.equal(after.createdAt.toISOString(), legacy.createdAt.toISOString(), "original application date kept");
    assert.deepEqual(after.timelineEvents.map((t) => t.type), ["STATUS_CHANGED"]);
    const again = await hiring.addToHiring(prisma, { organizationId: orgId, candidateId: ids.priya, jobId: jobs.netOpen });
    assert.equal(again.kind, "already_in_job");
  });
});

describe("Resume Parser integration boundary", () => {
  it("receiving the same records again creates nothing", async () => {
    const before = await prisma.application.count({ where: { job: { organizationId: orgId } } });
    const r = await rp.importResumeParserRecords({ prisma, organizationId: orgId, userId, records, apply: true, now: NOW });
    assert.equal(r.applicationsNew, 0);
    assert.equal(r.candidatesNew, 0);
    assert.equal(r.duplicatesExisting, records.length);
    assert.equal(await prisma.application.count({ where: { job: { organizationId: orgId } } }), before);
  });

  it("a record for someone already in HireOS adds history only; the profile is not changed", async () => {
    const before = await prisma.candidate.findUniqueOrThrow({ where: { id: ids.careers } });
    const r = await rp.importResumeParserRecords({
      prisma,
      organizationId: orgId,
      userId,
      records: [{ externalId: `K1-${tag}`, fullName: "Changed Name", email: email("careers"), jobRole: "UX Designer", experienceYears: 9, appliedAt: "2021-01-05" }],
      apply: true,
      now: NOW,
    });
    assert.equal(r.candidatesNew, 0);
    assert.equal(r.applicationsNew, 1);
    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: ids.careers } });
    assert.deepEqual(after, before);
  });

  it("history never lands on a current opening; a dry run writes nothing", async () => {
    const untouched = await prisma.application.findMany({
      where: { job: { organizationId: orgId }, source: "resume_parser", status: "ON_HOLD" },
      select: { job: { select: { status: true } } },
    });
    assert.ok(untouched.length >= 5);
    assert.ok(untouched.every((a) => a.job.status === "CLOSED"));
    const before = await prisma.application.count({ where: { job: { organizationId: orgId } } });
    const r = await rp.importResumeParserRecords({
      prisma,
      organizationId: orgId,
      userId,
      records: [{ externalId: `D1-${tag}`, fullName: "Dry Run", email: email("dry"), jobRole: "Brand New Role", appliedAt: "2024-01-01" }],
      apply: false,
      now: NOW,
    });
    assert.equal(r.applied, false);
    assert.equal(r.applicationsNew, 1);
    assert.equal(r.jobsNew, 1);
    assert.equal(await prisma.application.count({ where: { job: { organizationId: orgId } } }), before);
    assert.equal(await prisma.job.count({ where: { organizationId: orgId, title: "Brand New Role" } }), 0);
  });

  it("invalid dates and duplicates inside one batch are skipped", async () => {
    const base = { fullName: "Batch Person", email: email("batch"), jobRole: "Support Engineer", experienceYears: 1 };
    const r = await rp.importResumeParserRecords({
      prisma,
      organizationId: orgId,
      userId,
      records: [
        { ...base, externalId: `B1-${tag}`, appliedAt: "2024-02-10" },
        { ...base, externalId: `B1-${tag}`, appliedAt: "2024-02-11" },
        { ...base, externalId: `B2-${tag}`, appliedAt: "2024-02-12" },
        { ...base, externalId: `B3-${tag}`, jobRole: "Other Role", appliedAt: "2023-02-30" },
        { ...base, externalId: `B4-${tag}`, jobRole: "Other Role", appliedAt: "2027-01-01" },
        { ...base, externalId: `B5-${tag}`, jobRole: "Other Role", appliedAt: "1985-06-01" },
      ],
      apply: false,
      now: NOW,
    });
    assert.equal(r.received, 6);
    assert.equal(r.invalidRecords, 3);
    assert.equal(r.duplicatesInBatch, 2);
    assert.equal(r.applicationsNew, 1);
  });

  it("20,000 records in one batch are written in bulk, then fully skipped on repeat", async () => {
    volumeOrgId = (await prisma.organization.create({ data: { name: `TP volume ${tag}`, slug: `${tag}-volume` } })).id;
    const roles = ["Java Developer", ".NET Developer", "QA Engineer", "Data Analyst", "DevOps Engineer"];
    const many = Array.from({ length: 20_000 }, (_, i) => ({
      externalId: `V${i}-${tag}`,
      fullName: `Volume Person${i}`,
      email: `v${Math.floor(i / 2)}.${tag}@example.com`,
      jobRole: roles[i % roles.length],
      experienceYears: i % 15,
      appliedAt: `20${String(15 + (i % 10)).padStart(2, "0")}-0${1 + (i % 9)}-1${i % 9}`,
    }));
    const started = Date.now();
    const r = await rp.importResumeParserRecords({ prisma, organizationId: volumeOrgId, userId, records: many, apply: true, now: NOW });
    const ms = Date.now() - started;
    assert.equal(r.invalidRecords, 0);
    assert.equal(r.applicationsNew, 20_000);
    assert.equal(r.candidatesNew, 10_000);
    assert.equal(r.jobsNew, roles.length);
    assert.ok(ms < 120_000, `took ${ms} ms`);
    assert.equal(await prisma.application.count({ where: { job: { organizationId: volumeOrgId }, status: "ON_HOLD" } }), 20_000);
    assert.equal(await prisma.candidate.count({ where: { organizationId: volumeOrgId, ...filter.IN_HIRING_CANDIDATE_FILTER } }), 0);
    const page = await browse.browseTalent(prisma, volumeOrgId, f({ role: "QA Engineer", page: 3 }));
    assert.equal(page.rows.length, browse.TALENT_PAGE_SIZE);
    const again = await rp.importResumeParserRecords({ prisma, organizationId: volumeOrgId, userId, records: many, apply: true, now: NOW });
    assert.equal(again.applicationsNew, 0);
    assert.equal(again.duplicatesExisting, 20_000);
  });

  it("no API is pretended: without URL and key the client reports not configured", async () => {
    const client = rp.getResumeParserClient({});
    assert.equal(client.configured, false);
    await assert.rejects(client.search({ skills: ["python"] }, 1, 25), rp.ResumeParserNotConfiguredError);
    await assert.rejects(client.getResumeFile(1), rp.ResumeParserNotConfiguredError);
  });
});
