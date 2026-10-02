/**
 * Resume import against a THROWAWAY database. Never point this at a real one.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/resume-import.db.test.ts
 *
 * The database name must end in "_test". Schema must already be pushed there.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { importRow, planImport } from "../../src/lib/resume-import";

// Prisma and storage read these lazily (first query / first save), so setting
// them here, before any client is created, is enough.
const url = process.env.IMPORT_TEST_DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!dbName.endsWith("_test")) {
  throw new Error("Set IMPORT_TEST_DATABASE_URL to a throwaway database whose name ends in _test.");
}
process.env.DATABASE_URL = url;
const storageRoot = mkdtempSync(path.join(tmpdir(), "hireos-import-storage-"));
process.env.STORAGE_ROOT = storageRoot;

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `imp${Date.now()}`;
let dir: string;
let orgId: string;
let otherOrgId: string;
let javaJobId: string;
let otherOrgJobId: string;
let existingId: string;
const embedded: string[] = [];

const deps = {
  extractText: async (p: { fileName: string }) => {
    if (p.fileName.startsWith("scan")) throw new Error("no text layer");
    return `Resume text for ${p.fileName}`;
  },
  embed: async (id: string) => {
    embedded.push(id);
    return { updated: true };
  },
};

const csv = [
  "file,firstName,lastName,email,phone,location,job",
  `ravi.pdf,Ravi,Kumar,ravi.${tag}@example.com,999,Hyderabad,Java Developer`,
  `pool.docx,Pooja,S,pooja.${tag}@example.com,,,`,
  `ignored.pdf,Changed,Name,existing.${tag}@example.com,,,Java Developer`,
  `ignored.pdf,Changed,Name,existing.${tag}@example.com,,,`,
  `bad.pdf,Bad,Email,not-an-email,,,`,
  `missing.pdf,Miss,Ing,missing.${tag}@example.com,,,`,
  `ravi.pdf,Ravi,Kumar,dup.${tag}@example.com,,,No Such Job`,
  `ravi.pdf,Ravi,Kumar,ravi.${tag}@example.com,,,Java Developer`,
  `scan.pdf,Sam,Scan,scan.${tag}@example.com,,,Java Developer`,
  `ravi.pdf,Cross,Org,cross.${tag}@example.com,,,OTHER_ORG_JOB`,
].join("\n");

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hireos-import-files-"));
  await writeFile(path.join(dir, "ravi.pdf"), "%PDF-1.4 ravi");
  await writeFile(path.join(dir, "scan.pdf"), "%PDF-1.4 scan");
  await writeFile(path.join(dir, "pool.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 9]));

  const org = await prisma.organization.create({ data: { name: `Import ${tag}`, slug: tag } });
  const other = await prisma.organization.create({ data: { name: `Other ${tag}`, slug: `${tag}-other` } });
  orgId = org.id;
  otherOrgId = other.id;
  const user = await prisma.user.create({
    data: { email: `hr.${tag}@example.com`, passwordHash: "x", name: "HR", role: "HR_ADMIN", organizationId: orgId },
  });
  const job = await prisma.job.create({
    data: { organizationId: orgId, title: "Java Developer", description: "d", status: "OPEN", createdById: user.id },
  });
  javaJobId = job.id;
  const otherJob = await prisma.job.create({
    data: { organizationId: otherOrgId, title: "Secret", description: "d", status: "OPEN", createdById: user.id },
  });
  otherOrgJobId = otherJob.id;
  const existing = await prisma.candidate.create({
    data: {
      organizationId: orgId,
      email: `existing.${tag}@example.com`,
      firstName: "Original",
      lastName: "Person",
      resumeUrl: "resumes/original.pdf",
    },
  });
  existingId = existing.id;
});

after(async () => {
  await prisma.job.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.candidate.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.user.deleteMany({ where: { email: `hr.${tag}@example.com` } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
  await rm(storageRoot, { recursive: true, force: true });
});

async function counts() {
  return {
    candidates: await prisma.candidate.count({ where: { organizationId: orgId } }),
    applications: await prisma.application.count({ where: { job: { organizationId: orgId } } }),
  };
}

describe("resume import (throwaway DB)", () => {
  it("dry run classifies every row and writes nothing", async () => {
    const before = await counts();
    const plan = await planImport({
      prisma,
      organizationId: orgId,
      dir,
      csvText: csv.replace("OTHER_ORG_JOB", otherOrgJobId),
    });
    assert.deepEqual(await counts(), before);

    assert.deepEqual(
      plan.ready.map((r) => [r.rowNumber, r.action]),
      [
        [2, "NEW_CANDIDATE_AND_APPLICATION"],
        [3, "NEW_CANDIDATE"],
        [4, "APPLICATION_FOR_EXISTING"],
        [10, "NEW_CANDIDATE_AND_APPLICATION"],
      ],
    );
    const reasons = Object.fromEntries(plan.skipped.map((s) => [s.rowNumber, s.reasons.join("; ")]));
    assert.match(reasons[5]!, /already exists and no job/);
    assert.match(reasons[6]!, /email/);
    assert.match(reasons[7]!, /not found/);
    assert.match(reasons[8]!, /was not found in this organization/);
    assert.match(reasons[9]!, /duplicate/);
    assert.match(reasons[11]!, /was not found in this organization/, "other org's job id must not resolve");
  });

  it("apply creates candidates, applications and timeline; keeps existing profiles; re-run is a no-op", async () => {
    const plan = await planImport({ prisma, organizationId: orgId, dir, csvText: csv });
    const results = [];
    for (const row of plan.ready) {
      results.push(await importRow({ prisma, organizationId: orgId, dir, row, deps }));
    }
    assert.deepEqual(results.map((r) => r.status), ["CREATED", "CREATED", "APPLICATION_ADDED", "CREATED"]);

    const ravi = await prisma.candidate.findUniqueOrThrow({
      where: { organizationId_email: { organizationId: orgId, email: `ravi.${tag}@example.com` } },
      include: { applications: { include: { timelineEvents: true } } },
    });
    assert.equal(ravi.resumeText, "Resume text for ravi.pdf");
    assert.ok(ravi.resumeUrl?.startsWith("resumes/"));
    assert.ok(existsSync(path.join(storageRoot, ravi.resumeUrl!)), "resume file stored under STORAGE_ROOT");
    assert.equal(ravi.applications.length, 1);
    const app = ravi.applications[0]!;
    assert.equal(app.jobId, javaJobId);
    assert.equal(app.stage, "APPLIED");
    assert.equal(app.status, "ACTIVE");
    assert.equal(app.source, "bulk_import");
    assert.equal(app.timelineEvents[0]?.type, "APPLICATION_CREATED");
    assert.ok(embedded.includes(ravi.id));

    const pool = await prisma.candidate.findUniqueOrThrow({
      where: { organizationId_email: { organizationId: orgId, email: `pooja.${tag}@example.com` } },
      include: { applications: true },
    });
    assert.equal(pool.applications.length, 0);

    const existing = await prisma.candidate.findUniqueOrThrow({
      where: { id: existingId },
      include: { applications: true },
    });
    assert.equal(existing.firstName, "Original");
    assert.equal(existing.resumeUrl, "resumes/original.pdf");
    assert.equal(existing.applications.length, 1);

    const scan = await prisma.candidate.findUniqueOrThrow({
      where: { organizationId_email: { organizationId: orgId, email: `scan.${tag}@example.com` } },
      include: { applications: { include: { timelineEvents: true } } },
    });
    assert.equal(scan.resumeText, null);
    assert.ok(!embedded.includes(scan.id), "no embedding without resume text");
    assert.match(
      String((scan.applications[0]?.timelineEvents[0]?.payload as { parseError?: string }).parseError),
      /no text layer/,
    );

    assert.equal(await prisma.aIEvaluation.count({ where: { application: { job: { organizationId: orgId } } } }), 0);

    const afterFirst = await counts();
    for (const row of plan.ready) {
      const r = await importRow({ prisma, organizationId: orgId, dir, row, deps });
      assert.equal(r.status, "SKIPPED");
    }
    assert.deepEqual(await counts(), afterFirst);
    const replan = await planImport({ prisma, organizationId: orgId, dir, csvText: csv });
    assert.equal(replan.ready.length, 0);
  });

  it("a database failure leaves no stored resume file behind", async () => {
    const resumes = path.join(storageRoot, "resumes");
    const beforeFiles = await readdir(resumes);
    const row = {
      rowNumber: 99,
      data: { file: "ravi.pdf", firstName: "No", lastName: "Org", email: `noorg.${tag}@example.com` },
      job: null,
      action: "NEW_CANDIDATE" as const,
    };
    await assert.rejects(
      importRow({ prisma, organizationId: "missing-org-id", dir, row, deps }),
    );
    assert.deepEqual((await readdir(resumes)).sort(), beforeFiles.sort());
  });
});
