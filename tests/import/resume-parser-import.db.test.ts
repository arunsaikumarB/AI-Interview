/**
 * Resume Parser CSV import against a THROWAWAY database. Never point this at a real one.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/resume-parser-import.db.test.ts
 *
 * The database name must end in "_test". Schema must already be pushed there.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { readCsvTable } from "../../src/lib/resume-parser-import/file";
import { runResumeParserImport } from "../../src/lib/resume-parser-import/importer";
import { ACTIVE_PIPELINE_FILTER } from "../../src/lib/resume-parser-import/pipeline-filter";
import { RESUME_PARSER_SOURCE } from "../../src/lib/resume-parser-import/constants";
import type { ImportMapping } from "../../src/lib/resume-parser-import/mapping";

const url = process.env.IMPORT_TEST_DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!dbName.endsWith("_test")) {
  throw new Error("Set IMPORT_TEST_DATABASE_URL to a throwaway database whose name ends in _test.");
}
process.env.DATABASE_URL = url;

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `rp${Date.now()}`;
const NOW = new Date(Date.UTC(2026, 9, 2, 12));
let orgId: string;
let otherOrgId: string;
let perfOrgId: string;
let userId: string;
let javaJobId: string;
let existingId: string;
let otherOrgCandidateId: string;
let existingBefore: Record<string, unknown>;

const mapping: ImportMapping = {
  columns: { externalId: 0, fullName: 1, email: 2, phone: 3, jobRole: 4, experience: 5, appliedAt: 6, resumeReference: 7 },
  dateFormat: "DMY",
};

const csv = [
  "Applicant ID,Candidate Name,Email,Mobile,Applied Role,Experience,Applied Date,Resume File",
  `RP-1,Ravi Kumar,ravi.${tag}@example.com,900,java developer,3 yrs,15/03/2025,ravi.pdf`,
  `RP-2,Ravi Kumar,RAVI.${tag}@example.com,900,Data Analyst,3,20/04/2025,ravi2.pdf`,
  `RP-3,Changed Name,EXISTING.${tag}@example.com,000,Java Developer,1,01/02/2025,`,
  `RP-4,Changed Name,existing.${tag}@example.com,000,QA Tester,1,02/02/2025,`,
  `RP-5,Asha Rao,asha.${tag}@example.com,,QA Tester,Fresher,,`,
  `RP-1,Ravi Kumar,ravi.${tag}@example.com,900,Java Developer,3,15/03/2025,ravi.pdf`,
  `RP-6,Bad Row,not-an-email,,QA Tester,,,`,
  `RP-7,Bad Date,bad.${tag}@example.com,,QA Tester,,31/02/2025,`,
].join("\n");

const table = () => readCsvTable(new TextEncoder().encode(csv));

async function orgCounts(id = orgId) {
  return {
    candidates: await prisma.candidate.count({ where: { organizationId: id } }),
    applications: await prisma.application.count({ where: { job: { organizationId: id } } }),
    jobs: await prisma.job.count({ where: { organizationId: id } }),
    events: await prisma.timelineEvent.count({ where: { application: { job: { organizationId: id } } } }),
  };
}

function run(apply: boolean, extra: Partial<Parameters<typeof runResumeParserImport>[0]> = {}) {
  const { header, rows } = table();
  return runResumeParserImport({ prisma, organizationId: orgId, userId, header, rows, mapping, apply, now: NOW, ...extra });
}

before(async () => {
  const [org, other, perf] = await Promise.all([
    prisma.organization.create({ data: { name: `RP ${tag}`, slug: tag } }),
    prisma.organization.create({ data: { name: `RP other ${tag}`, slug: `${tag}-other` } }),
    prisma.organization.create({ data: { name: `RP perf ${tag}`, slug: `${tag}-perf` } }),
  ]);
  orgId = org.id;
  otherOrgId = other.id;
  perfOrgId = perf.id;
  userId = (
    await prisma.user.create({
      data: { email: `hr.${tag}@example.com`, passwordHash: "x", name: "HR", role: "HR_ADMIN", organizationId: orgId },
    })
  ).id;
  javaJobId = (
    await prisma.job.create({
      data: { organizationId: orgId, title: "Java Developer", description: "d", status: "OPEN", createdById: userId },
    })
  ).id;
  const existing = await prisma.candidate.create({
    data: {
      organizationId: orgId,
      email: `Existing.${tag}@example.com`,
      firstName: "Original",
      lastName: "Person",
      phone: "111",
      experience: 7,
      resumeUrl: "resumes/original.pdf",
    },
  });
  existingId = existing.id;
  await prisma.application.create({
    data: { candidateId: existingId, jobId: javaJobId, stage: "SCREENING", status: "ACTIVE", source: "careers_site" },
  });
  existingBefore = (await prisma.candidate.findUniqueOrThrow({ where: { id: existingId } })) as unknown as Record<string, unknown>;
  otherOrgCandidateId = (
    await prisma.candidate.create({
      data: { organizationId: otherOrgId, email: `ravi.${tag}@example.com`, firstName: "Other", lastName: "Org" },
    })
  ).id;
});

after(async () => {
  const orgs = [orgId, otherOrgId, perfOrgId].filter(Boolean);
  await prisma.job.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.candidate.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `${tag}@example.com` } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
});

describe("Resume Parser import (throwaway DB)", () => {
  it("check (dry run) reports the plan and writes nothing", async () => {
    const before = await orgCounts();
    const r = await run(false);
    assert.equal(r.applied, false);
    assert.equal(r.totalRows, 8);
    assert.equal(r.errorRows, 2);
    assert.deepEqual(r.errors.map((e) => e.rowNumber), [8, 9]);
    assert.equal(r.duplicatesInFile, 1);
    assert.equal(r.duplicatesExisting, 0, "history never collides with the current Java Developer opening");
    assert.equal(r.applicationsNew, 5);
    assert.equal(r.candidatesNew, 2);
    assert.equal(r.candidatesExisting, 1);
    assert.equal(r.jobsNew, 3);
    assert.deepEqual(r.jobsNewTitles.sort(), ["Data Analyst", "QA Tester", "java developer"]);
    assert.equal(r.missingDates, 1);
    assert.deepEqual(await orgCounts(), before);
  });

  it("imports candidates, applications, closed historical jobs and timeline events", async () => {
    const before = await orgCounts();
    const r = await run(true);
    assert.equal(r.applied, true);
    assert.equal(r.applicationsNew, 5);
    assert.equal(r.candidatesNew, 2);
    assert.equal(r.jobsNew, 3);
    const afterCounts = await orgCounts();
    assert.equal(afterCounts.candidates, before.candidates + 2);
    assert.equal(afterCounts.applications, before.applications + 5);
    assert.equal(afterCounts.jobs, before.jobs + 3);
    assert.equal(afterCounts.events, before.events + 5);

    const ravi = await prisma.candidate.findFirstOrThrow({
      where: { organizationId: orgId, email: `ravi.${tag}@example.com` },
      include: { applications: { include: { job: true, timelineEvents: true }, orderBy: { createdAt: "asc" } } },
    });
    assert.equal(ravi.firstName, "Ravi");
    assert.equal(ravi.lastName, "Kumar");
    assert.equal(ravi.experience, 3);
    assert.equal(ravi.resumeUrl, null, "external resume is never stored as a HireOS file path");
    assert.equal(ravi.applications.length, 2, "one candidate, two applications");
    const [javaApp, analystApp] = ravi.applications;
    assert.notEqual(javaApp.jobId, javaJobId, "history is never attached to the open opening");
    assert.equal(javaApp.job.status, "CLOSED");
    assert.equal(javaApp.job.title.toLowerCase(), "java developer");
    assert.equal(javaApp.stage, "APPLIED");
    assert.equal(javaApp.status, "ON_HOLD");
    assert.equal(javaApp.source, RESUME_PARSER_SOURCE);
    assert.equal(javaApp.createdAt.toISOString(), "2025-03-15T12:00:00.000Z");
    assert.equal(javaApp.updatedAt.toISOString(), "2025-03-15T12:00:00.000Z");
    assert.equal(javaApp.timelineEvents.length, 1);
    assert.equal(javaApp.timelineEvents[0].type, "APPLICATION_CREATED");
    assert.deepEqual(javaApp.timelineEvents[0].payload, {
      source: RESUME_PARSER_SOURCE,
      appliedAtKnown: true,
      resumeParserId: "RP-1",
      resumeReference: "ravi.pdf",
    });
    assert.equal(analystApp.job.title, "Data Analyst");
    assert.equal(analystApp.job.status, "CLOSED");
    assert.equal(analystApp.job.createdById, userId);
    assert.equal(ravi.updatedAt.toISOString(), "2025-04-20T12:00:00.000Z", "profile dated by latest application");

    const asha = await prisma.candidate.findFirstOrThrow({
      where: { organizationId: orgId, email: `asha.${tag}@example.com` },
      include: { applications: true },
    });
    assert.equal(asha.experience, 0);
    assert.equal(asha.applications[0].createdAt.toISOString(), NOW.toISOString(), "blank date = import time");
  });

  it("leaves existing candidates unchanged and only adds new applications", async () => {
    const now = (await prisma.candidate.findUniqueOrThrow({ where: { id: existingId } })) as unknown as Record<string, unknown>;
    assert.deepEqual(now, existingBefore);
    const apps = await prisma.application.findMany({ where: { candidateId: existingId }, include: { job: true } });
    assert.equal(apps.length, 3);
    const careers = apps.find((a) => a.source === "careers_site");
    assert.equal(careers?.stage, "SCREENING", "existing application untouched");
    assert.equal(careers?.status, "ACTIVE");
    assert.equal(careers?.jobId, javaJobId);
    const history = apps.filter((a) => a.source === RESUME_PARSER_SOURCE);
    assert.deepEqual(history.map((a) => a.job.title.toLowerCase()).sort(), ["java developer", "qa tester"]);
    assert.ok(history.every((a) => a.job.status === "CLOSED"));
    assert.equal(await prisma.candidate.count({ where: { organizationId: orgId, email: { equals: `existing.${tag}@example.com`, mode: "insensitive" } } }), 1);
  });

  it("does not touch another organization", async () => {
    const other = await prisma.candidate.findUniqueOrThrow({ where: { id: otherOrgCandidateId }, include: { applications: true } });
    assert.equal(other.firstName, "Other");
    assert.equal(other.applications.length, 0);
    assert.equal((await orgCounts(otherOrgId)).jobs, 0);
  });

  it("a later import reuses the Closed historical job instead of the open one", async () => {
    const t = readCsvTable(
      new TextEncoder().encode(
        ["ID,Name,Email,Phone,Role,Exp,Date,Resume", `RP-9,Kiran Das,kiran.${tag}@example.com,,Java  Developer,2,01/01/2024,`].join("\n"),
      ),
    );
    const r = await runResumeParserImport({ prisma, organizationId: orgId, userId, header: t.header, rows: t.rows, mapping, apply: true, now: NOW });
    assert.equal(r.jobsNew, 0);
    const app = await prisma.application.findFirstOrThrow({
      where: { candidate: { email: `kiran.${tag}@example.com` } },
      include: { job: true },
    });
    assert.equal(app.job.status, "CLOSED");
    assert.notEqual(app.jobId, javaJobId);
  });

  it("uploading the same file again creates nothing", async () => {
    const before = await orgCounts();
    const r = await run(true);
    assert.equal(r.applicationsNew, 0);
    assert.equal(r.candidatesNew, 0);
    assert.equal(r.jobsNew, 0);
    assert.equal(r.duplicatesExisting, 5);
    assert.deepEqual(await orgCounts(), before);
  });

  it("without a Resume Parser ID column, duplicates are still caught by email + role", async () => {
    const before = await orgCounts();
    const columns = { ...mapping.columns };
    delete columns.externalId;
    const r = await run(true, { mapping: { ...mapping, columns } });
    assert.equal(r.applicationsNew, 0);
    assert.deepEqual(await orgCounts(), before);
  });

  it("a failure during the import rolls back everything", async () => {
    const before = await orgCounts();
    const header = "ID,Name,Email,Phone,Role,Exp,Date,Resume";
    const rows = [`RB-1,New Person,newperson.${tag}@example.com,,Brand New Role,,,`];
    const t = readCsvTable(new TextEncoder().encode([header, ...rows].join("\n")));
    await assert.rejects(
      runResumeParserImport({
        prisma,
        organizationId: orgId,
        userId,
        header: t.header,
        rows: t.rows,
        mapping,
        apply: true,
        now: NOW,
        beforeApplications: async () => {
          throw new Error("injected failure");
        },
      }),
      /injected failure/,
    );
    assert.deepEqual(await orgCounts(), before);
    assert.equal(await prisma.job.count({ where: { organizationId: orgId, title: "Brand New Role" } }), 0);
  });

  it("untouched imports stay out of the active pipeline until HR moves them", async () => {
    const pipelineCount = () =>
      prisma.application.count({ where: { job: { organizationId: orgId }, AND: [ACTIVE_PIPELINE_FILTER] } });
    assert.equal(await pipelineCount(), 1, "only the careers application");
    const imported = await prisma.application.findFirstOrThrow({
      where: { job: { organizationId: orgId }, source: RESUME_PARSER_SOURCE, candidate: { email: `asha.${tag}@example.com` } },
    });
    await prisma.application.update({ where: { id: imported.id }, data: { stage: "SCREENING" } });
    assert.equal(await pipelineCount(), 2);
  });

  it("imports 20,000 rows in bulk, then re-checks them as duplicates", async () => {
    const roles = Array.from({ length: 15 }, (_, i) => `Perf Role ${i}`);
    const lines = ["ID,Name,Email,Phone,Role,Exp,Date,Resume"];
    for (let i = 0; i < 20_000; i++) {
      const person = i % 18_000;
      const role = roles[(i + Math.floor(i / 18_000)) % roles.length];
      const day = String((i % 28) + 1).padStart(2, "0");
      lines.push(`PERF-${i},Person ${person},p${person}.${tag}@example.com,98${i},${role},${i % 12},${day}/0${(i % 9) + 1}/2024,cv-${i}.pdf`);
    }
    const t = readCsvTable(new TextEncoder().encode(lines.join("\n")));
    const args = { prisma, organizationId: perfOrgId, userId, header: t.header, rows: t.rows, mapping, now: NOW };

    let start = Date.now();
    const check = await runResumeParserImport({ ...args, apply: false });
    const checkMs = Date.now() - start;
    assert.equal(check.applicationsNew, 20_000);

    start = Date.now();
    const r = await runResumeParserImport({ ...args, apply: true });
    const importMs = Date.now() - start;
    assert.equal(r.errorRows, 0);
    assert.equal(r.applicationsNew, 20_000);
    assert.equal(r.candidatesNew, 18_000);
    assert.equal(r.jobsNew, 15);
    const counts = await orgCounts(perfOrgId);
    assert.deepEqual(counts, { candidates: 18_000, applications: 20_000, jobs: 15, events: 20_000 });

    start = Date.now();
    const again = await runResumeParserImport({ ...args, apply: true });
    const reimportMs = Date.now() - start;
    assert.equal(again.applicationsNew, 0);
    assert.equal(again.duplicatesExisting, 20_000);
    assert.deepEqual(await orgCounts(perfOrgId), counts);

    console.log(`[20k] check ${checkMs} ms, import ${importMs} ms, re-import ${reimportMs} ms`);
    assert.ok(importMs < 120_000, `import took ${importMs} ms`);
  });
});
