/**
 * Careers site sync, against a THROWAWAY database.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/careers-sync.db.test.ts
 *
 * The database name must end in "_test". Schema (incl. prisma/manual/20261007_careers_sync.sql) must be there.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  careersApplicationSchema,
  CareersUnavailableError,
  type CareersApplication,
  type CareersClient,
  type CareersResumeFile,
} from "../../src/lib/integrations/careers/client";
import { CAREERS_APPLICATION_SOURCE, CAREERS_SOURCE } from "../../src/lib/integrations/careers/constants";
import { syncCareersApplications, type CareersSyncOptions } from "../../src/lib/integrations/careers/sync";
import { createCareersRunner, readCareersState } from "../../src/lib/integrations/careers/runner";
import type { UploadDeps } from "../../src/lib/resume-upload/upload";

const url = process.env.IMPORT_TEST_DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!dbName.endsWith("_test")) {
  throw new Error("Set IMPORT_TEST_DATABASE_URL to a throwaway database whose name ends in _test.");
}
process.env.DATABASE_URL = url;
const storageRoot = mkdtempSync(path.join(tmpdir(), "hireos-careers-"));
process.env.STORAGE_ROOT = storageRoot;

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `cs${Date.now()}`;
const email = (name: string) => `${name}.${tag}@example.com`;

// ---- fake careers site -------------------------------------------------------------------
let live: CareersApplication[] = [];
let pageSize = 100;
let failOnPage: number | null = null;
const resumes = new Map<number, CareersResumeFile>();
const downloads: number[] = [];
const listCalls: Array<{ page: number; after: string | null | undefined }> = [];
let listGate: Promise<void> | null = null;

const client: CareersClient = {
  async listApplications({ page, after }) {
    listCalls.push({ page, after });
    if (listGate) await listGate;
    if (failOnPage === page) throw new CareersUnavailableError("unreachable");
    const rows = after ? live.filter((a) => a.applied_on > after) : live;
    const totalPages = Math.ceil(rows.length / pageSize);
    return {
      page,
      total: rows.length,
      totalPages,
      applications: rows.slice((page - 1) * pageSize, page * pageSize),
      malformed: 0,
    };
  },
  async getResume(id) {
    downloads.push(id);
    return resumes.get(id) ?? null;
  },
};

const texts = new Map<string, string>();
const embedded: string[] = [];
const profileQueued: string[] = [];
const upload: UploadDeps = {
  extractText: async ({ buffer }) => {
    const t = texts.get(buffer.toString("latin1"));
    if (t === undefined) throw new Error("Could not extract text");
    return t;
  },
  embed: async (id) => {
    embedded.push(id);
  },
  queueProfile: async (jobs) => {
    profileQueued.push(...jobs.map((j) => j.candidateId));
  },
};
const screened: string[] = [];
const queueScreening = (id: string) => {
  screened.push(id);
  return true;
};

function application(id: number, over: Partial<Record<keyof CareersApplication, unknown>> = {}): CareersApplication {
  return careersApplicationSchema.parse({
    application_id: id,
    applied_on: "2026-10-01 10:00:00",
    applicant_name: `Person ${id}`,
    applicant_email: email(`p${id}`),
    applicant_phone: "+91 98765 43210",
    job_id: 10,
    job_title: "Data Analyst &amp; BI &#8211; Pune",
    cover_letter: "<p>I would like to join.</p>",
    total_experience: "3 years",
    skills_exposure: "Python, SQL",
    current_town: "Pune",
    current_ctc: "6 LPA",
    notice_period: "30 days",
    linkedin_url: "https://linkedin.com/in/someone",
    resume_filename: `cv-${id}.pdf`,
    resume_url: "https://evil.example/should-not-be-used",
    ...over,
  });
}

function withResume(id: number, text: string): void {
  const data = Buffer.from(`%PDF-1.4\ncareers-${tag}-${id}`);
  texts.set(data.toString("latin1"), text);
  resumes.set(id, { fileName: `cv-${id}.pdf`, mimeType: "application/pdf", data });
}

// ---- fixtures -------------------------------------------------------------------------------
let orgId: string;
let otherOrgId: string;
let adminId: string;
let recruiterId: string;
let existingId: string;
let otherOrgCandidateId: string;
let manualJobId: string;
let otherOrgCareersJobId: string;

const opts = (over: Partial<CareersSyncOptions> = {}): CareersSyncOptions => ({
  organizationId: orgId,
  actorId: adminId,
  mode: "full",
  screenAfter: null,
  ...over,
});
const sync = (over: Partial<CareersSyncOptions> = {}) =>
  syncCareersApplications(prisma, { client, upload, queueScreening }, opts(over));
const careersJob = (externalId: string) =>
  prisma.job.findUniqueOrThrow({
    where: { organizationId_externalSource_externalId: { organizationId: orgId, externalSource: CAREERS_SOURCE, externalId } },
  });
const appByExternal = (externalId: string) =>
  prisma.application.findFirst({ where: { externalSource: CAREERS_SOURCE, externalId, job: { organizationId: orgId } } });

before(async () => {
  orgId = (await prisma.organization.create({ data: { name: `Careers ${tag}`, slug: tag } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `Careers other ${tag}`, slug: `${tag}-o` } })).id;
  adminId = (
    await prisma.user.create({
      data: { email: `admin.${tag}@example.com`, passwordHash: "x", name: "Admin", role: "HR_ADMIN", organizationId: orgId },
    })
  ).id;
  recruiterId = (
    await prisma.user.create({
      data: { email: `rec.${tag}@example.com`, passwordHash: "x", name: "Rec", role: "RECRUITER", organizationId: orgId },
    })
  ).id;
  existingId = (
    await prisma.candidate.create({
      data: { organizationId: orgId, email: email("Existing"), firstName: "Existing", lastName: "Person", phone: "111", skills: ["Kept"] },
    })
  ).id;
  otherOrgCandidateId = (
    await prisma.candidate.create({
      data: { organizationId: otherOrgId, email: email("shared"), firstName: "Other", lastName: "Org", phone: "999" },
    })
  ).id;
  manualJobId = (
    await prisma.job.create({
      data: { organizationId: orgId, title: "Made in HireOS", description: "d", status: "OPEN", createdById: adminId },
    })
  ).id;
  otherOrgCareersJobId = (
    await prisma.job.create({
      data: {
        organizationId: otherOrgId,
        title: "Other org careers job",
        description: "d",
        status: "OPEN",
        createdById: adminId,
        externalSource: CAREERS_SOURCE,
        externalId: "20",
      },
    })
  ).id;
});

after(async () => {
  await prisma.candidate.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.job.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.user.deleteMany({ where: { email: { in: [`admin.${tag}@example.com`, `rec.${tag}@example.com`] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("Careers site sync (throwaway DB)", () => {
  it("first import: creates jobs and candidates, links existing people, runs no AI", async () => {
    withResume(1, "Person One\nPython analyst");
    withResume(7, "Person Seven\nJava");
    resumes.set(5, { fileName: "cv-5.exe", mimeType: "application/octet-stream", data: Buffer.from("MZ\x90\x00binary") });
    live = [
      application(1),
      application(2, { applicant_email: email("EXISTING").toUpperCase(), applicant_name: "Changed Name" }),
      application(3, { job_id: 20, job_title: "Java Developer" }),
      application(4, { applicant_email: "not-an-email" }),
      application(5, { job_id: 20, job_title: "Java Developer" }),
      application(6, { applicant_email: email("p1"), job_id: 20, job_title: "Java Developer", applied_on: "2026-10-02 09:00:00" }),
      application(7, { applicant_email: email("shared") }),
    ];
    pageSize = 3;
    const r = await sync();

    assert.equal(r.complete, true);
    assert.equal(r.error, null);
    assert.equal(r.seen, 7);
    assert.equal(r.jobsCreated, 2);
    assert.equal(r.created, 4); // 1, 3 (no resume), 5 (bad file), 7
    assert.equal(r.withoutResume, 2);
    assert.equal(r.linked, 2); // 2 (existing), 6 (person 1 again, other job)
    assert.equal(r.invalid, 1);
    assert.equal(r.failed, 0);
    assert.equal(r.screeningQueued, 0);
    assert.equal(r.latestAppliedOn, "2026-10-02 09:00:00");
    assert.deepEqual(screened, []);
    assert.deepEqual(profileQueued, [], "no background AI profile reading on the first import");

    const job10 = await careersJob("10");
    assert.equal(job10.title, "Data Analyst & BI – Pune");
    assert.equal(job10.status, "OPEN");
    assert.equal(job10.createdById, adminId);
    assert.equal((await careersJob("20")).title, "Java Developer");

    const a1 = await appByExternal("1");
    assert.ok(a1);
    assert.equal(a1.jobId, job10.id);
    assert.equal(a1.stage, "APPLIED");
    assert.equal(a1.status, "ACTIVE");
    assert.equal(a1.source, CAREERS_APPLICATION_SOURCE);
    assert.match(a1.coverNote ?? "", /application 1\)/);
    assert.match(a1.coverNote ?? "", /Notice period: 30 days/);
    assert.match(a1.coverNote ?? "", /Cover letter:\nI would like to join\./);
    const c1 = await prisma.candidate.findUniqueOrThrow({ where: { id: a1.candidateId } });
    assert.equal(c1.email, email("p1"));
    assert.deepEqual([c1.firstName, c1.lastName], ["Person", "1"]);
    assert.equal(c1.experience, 3);
    assert.equal(c1.location, "Pune");
    assert.deepEqual(c1.skills, ["Python", "SQL"]);
    assert.ok(c1.resumeUrl);
    assert.match(c1.resumeText ?? "", /Python analyst/);
    assert.ok(embedded.includes(c1.id));
    const stored = await readFile(path.join(storageRoot, c1.resumeUrl!));
    assert.equal(stored.toString("latin1"), resumes.get(1)!.data.toString("latin1"));
    const events = await prisma.timelineEvent.findMany({ where: { applicationId: a1.id }, orderBy: { type: "asc" } });
    assert.deepEqual(events.map((e) => e.type).sort(), ["APPLICATION_CREATED", "DOCUMENT_UPLOADED"]);
    const created = events.find((e) => e.type === "APPLICATION_CREATED")!.payload as Record<string, unknown>;
    assert.equal(created.source, CAREERS_APPLICATION_SOURCE);
    assert.equal(created.careersApplicationId, 1);

    // The existing candidate is never changed; it only gains the application.
    const existing = await prisma.candidate.findUniqueOrThrow({ where: { id: existingId } });
    assert.deepEqual([existing.firstName, existing.phone, existing.skills], ["Existing", "111", ["Kept"]]);
    assert.equal((await appByExternal("2"))?.candidateId, existingId);
    assert.ok(!downloads.includes(2), "no resume download for an existing candidate");

    // Person 1's second application (job 20) uses the same candidate.
    assert.equal((await appByExternal("6"))?.candidateId, c1.id);

    // No resume (404) and a disallowed file: the applicant is still saved, without a file.
    for (const id of ["3", "5"]) {
      const a = await appByExternal(id);
      assert.ok(a, `application ${id}`);
      const c = await prisma.candidate.findUniqueOrThrow({ where: { id: a.candidateId } });
      assert.equal(c.resumeUrl, null);
      assert.equal(c.experience, 3);
    }

    // Another organization's candidate with the same email is untouched; this org gets its own.
    const a7 = await appByExternal("7");
    assert.ok(a7);
    assert.notEqual(a7.candidateId, otherOrgCandidateId);
    const other = await prisma.candidate.findUniqueOrThrow({ where: { id: otherOrgCandidateId } });
    assert.deepEqual([other.firstName, other.phone], ["Other", "999"]);
    assert.equal(await prisma.application.count({ where: { candidateId: otherOrgCandidateId } }), 0);

    assert.equal(await prisma.aIEvaluation.count({ where: { application: { job: { organizationId: orgId } } } }), 0);
  });

  it("running again imports nothing twice and downloads nothing", async () => {
    const before = await prisma.application.count({ where: { job: { organizationId: orgId } } });
    const candidatesBefore = await prisma.candidate.count({ where: { organizationId: orgId } });
    downloads.length = 0;
    const r = await sync();
    assert.equal(r.alreadyImported, 6);
    assert.equal(r.created + r.linked + r.jobsCreated, 0);
    assert.deepEqual(downloads, []);
    assert.equal(await prisma.application.count({ where: { job: { organizationId: orgId } } }), before);
    assert.equal(await prisma.candidate.count({ where: { organizationId: orgId } }), candidatesBefore);
  });

  it("later applicants get advisory screening; older late arrivals and no-resume people do not", async () => {
    withResume(8, "Person Eight\nSQL");
    withResume(9, "Person Nine\nSQL");
    live = [
      ...live,
      application(8, { applied_on: "2026-10-05 12:00:00" }),
      application(9, { applied_on: "2026-09-30 12:00:00" }),
      application(10, { applied_on: "2026-10-05 12:30:00" }),
    ];
    const r = await sync({ mode: "incremental", after: "2026-01-01 00:00:00", screenAfter: "2026-10-02 09:00:00" });
    assert.equal(r.created, 3);
    assert.equal(r.screeningQueued, 1);
    const a8 = await appByExternal("8");
    assert.deepEqual(screened, [a8!.id]);
    assert.equal(a8!.stage, "APPLIED");
    assert.ok(profileQueued.includes(a8!.candidateId), "background profile reading after the first import");
  });

  it("an incremental run never closes jobs", async () => {
    live = live.filter((a) => a.job_id !== 20);
    const r = await sync({ mode: "incremental", after: "2026-10-05 00:00:00", screenAfter: "2026-10-02 09:00:00" });
    assert.equal(r.jobsClosed, 0);
    assert.equal((await careersJob("20")).status, "OPEN");
  });

  it("a failed or empty full read closes nothing", async () => {
    pageSize = 2;
    failOnPage = 2;
    const failed = await sync();
    assert.equal(failed.complete, false);
    assert.equal(failed.error, "unreachable");
    assert.equal(failed.jobsClosed, 0);
    failOnPage = null;

    const saved = live;
    live = [];
    const empty = await sync();
    assert.equal(empty.complete, true);
    assert.equal(empty.jobsClosed, 0);
    live = saved;
    assert.equal((await careersJob("20")).status, "OPEN");
  });

  it("a complete full read closes expired careers jobs only, and keeps their people and history", async () => {
    const appsBefore = await prisma.application.count({ where: { jobId: (await careersJob("20")).id } });
    const r = await sync();
    assert.equal(r.complete, true);
    assert.equal(r.jobsClosed, 1);
    const job20 = await careersJob("20");
    assert.equal(job20.status, "CLOSED");
    assert.equal(await prisma.application.count({ where: { jobId: job20.id } }), appsBefore);
    assert.equal((await careersJob("10")).status, "OPEN");
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: manualJobId } })).status, "OPEN");
    assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: otherOrgCareersJobId } })).status, "OPEN");
    const stages = await prisma.application.groupBy({
      by: ["stage", "status"],
      where: { job: { organizationId: orgId } },
      _count: true,
    });
    assert.deepEqual(stages.map((s) => `${s.stage}/${s.status}`), ["APPLIED/ACTIVE"]);
  });

  it("a closed job is not reopened when it comes back", async () => {
    live = [...live, application(11, { job_id: 20, job_title: "Java Developer", applied_on: "2026-10-06 08:00:00" })];
    const r = await sync({ screenAfter: "2026-10-02 09:00:00" });
    assert.equal(r.created, 1);
    assert.equal((await careersJob("20")).status, "CLOSED");
  });
});

describe("Careers sync runner (throwaway DB)", () => {
  const stateFile = path.join(storageRoot, "integrations", "careers-sync.json");
  let clock = new Date("2026-10-07T10:00:00Z");
  const runner = () =>
    createCareersRunner(
      { db: prisma, client, upload, queueScreening, stateFile, now: () => clock },
      { CAREERS_ORGANIZATION_ID: orgId, NODE_ENV: "production" },
    );

  it("first run is a full read without screening and remembers where it got to", async () => {
    screened.length = 0;
    pageSize = 100;
    const result = await runner().run("schedule", recruiterId);
    assert.equal(result.status, "done");
    if (result.status !== "done") return;
    assert.equal(result.report.mode, "full");
    assert.equal(result.report.screeningQueued, 0);
    const state = await readCareersState(stateFile);
    assert.equal(state.screenAfter, "2026-10-06 08:00:00");
    assert.equal(state.cursor, "2026-10-06 08:00:00");
    assert.equal(state.lastRun?.trigger, "schedule");
  });

  it("scheduled runs read only newer applications and screen new applicants", async () => {
    withResume(12, "Person Twelve\nPython");
    live = [...live, application(12, { applied_on: "2026-10-07 09:00:00" })];
    clock = new Date("2026-10-07T10:15:00Z");
    listCalls.length = 0;
    const result = await runner().run("schedule");
    assert.equal(result.status, "done");
    if (result.status !== "done") return;
    assert.equal(result.report.mode, "incremental");
    assert.equal(listCalls[0].after, "2026-10-06 07:50:00");
    assert.equal(result.report.created, 1);
    assert.equal(result.report.screeningQueued, 1);
    assert.equal((await readCareersState(stateFile)).cursor, "2026-10-07 09:00:00");
  });

  it("Sync now always reads everything; a second run while one is going is refused", async () => {
    const r = runner();
    let release!: () => void;
    listGate = new Promise((resolve) => {
      release = resolve;
    });
    const first = r.run("manual", adminId);
    assert.equal(r.isRunning(), true);
    assert.deepEqual(await r.run("manual", adminId), { status: "busy" });
    release();
    listGate = null;
    const done = await first;
    assert.equal(done.status, "done");
    if (done.status === "done") assert.equal(done.report.mode, "full");
    assert.equal(r.isRunning(), false);
    const status = await r.status();
    assert.equal(status.initialImportDone, true);
    assert.equal(status.intervalMinutes, 15);
    assert.equal(status.lastRun?.trigger, "manual");
  });

  it("refuses an unknown organization and an organization without admins", async () => {
    const unknown = createCareersRunner(
      { db: prisma, client, upload, stateFile, now: () => clock },
      { CAREERS_ORGANIZATION_ID: "nope" },
    );
    assert.deepEqual(await unknown.run("schedule"), { status: "no_organization" });
    const noAdmin = createCareersRunner(
      { db: prisma, client, upload, stateFile, now: () => clock },
      { CAREERS_ORGANIZATION_ID: otherOrgId },
    );
    assert.deepEqual(await noAdmin.run("schedule"), { status: "no_staff_user" });
  });
});
