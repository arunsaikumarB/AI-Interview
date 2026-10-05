/**
 * Attaching resume files to imported Resume Parser candidates, against a THROWAWAY database.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/resume-parser-resumes.db.test.ts
 *
 * The database name must end in "_test". Schema must already be pushed there.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { readCsvTable } from "../../src/lib/resume-parser-import/file";
import { runResumeParserImport } from "../../src/lib/resume-parser-import/importer";
import { attachResumeFile, matchResumeNames, type AttachDeps } from "../../src/lib/resume-parser-import/resumes";
import type { ImportMapping } from "../../src/lib/resume-parser-import/mapping";

const url = process.env.IMPORT_TEST_DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!dbName.endsWith("_test")) {
  throw new Error("Set IMPORT_TEST_DATABASE_URL to a throwaway database whose name ends in _test.");
}
process.env.DATABASE_URL = url;
const storageRoot = mkdtempSync(path.join(tmpdir(), "hireos-rp-resumes-"));
process.env.STORAGE_ROOT = storageRoot;

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `rpr${Date.now()}`;
const mapping: ImportMapping = { columns: { fullName: 0, email: 1, jobRole: 2, resumeReference: 3 }, dateFormat: "DMY" };
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}`);
const embedded: string[] = [];
const deps: AttachDeps = {
  extractText: async ({ fileName }) => `Resume text of ${fileName}`,
  embed: async (id) => {
    embedded.push(id);
  },
};
let orgId: string;
let otherOrgId: string;
let userId: string;

async function importCsv(organizationId: string, rows: string[]) {
  const t = readCsvTable(new TextEncoder().encode(["Name,Email,Role,Resume", ...rows].join("\n")));
  return runResumeParserImport({ prisma, organizationId, userId, header: t.header, rows: t.rows, mapping, apply: true });
}
const candidate = (organizationId: string, email: string) =>
  prisma.candidate.findFirstOrThrow({ where: { organizationId, email } });
const storedFiles = async () => readdir(path.join(storageRoot, "resumes")).catch(() => [] as string[]);

before(async () => {
  orgId = (await prisma.organization.create({ data: { name: `RPR ${tag}`, slug: tag } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `RPR other ${tag}`, slug: `${tag}-o` } })).id;
  userId = (
    await prisma.user.create({
      data: { email: `hr.${tag}@example.com`, passwordHash: "x", name: "HR", role: "HR_ADMIN", organizationId: orgId },
    })
  ).id;
  await prisma.candidate.create({
    data: { organizationId: orgId, email: `old.${tag}@example.com`, firstName: "Old", lastName: "Resume", resumeUrl: "resumes/kept.pdf" },
  });
  await importCsv(orgId, [
    `Ravi Kumar,ravi.${tag}@example.com,Dev,C:\\cv\\Ravi.pdf`,
    `Ravi Kumar,ravi.${tag}@example.com,QA,Ravi.pdf`,
    `Asha Rao,asha.${tag}@example.com,Dev,https://rp.local/files/asha.pdf?v=2`,
    `Scan Person,scan.${tag}@example.com,Dev,scan.pdf`,
    `Race Person,race.${tag}@example.com,Dev,race.pdf`,
    `One,one.${tag}@example.com,Dev,resume.pdf`,
    `Two,two.${tag}@example.com,Dev,resume.pdf`,
    `Old Resume,old.${tag}@example.com,Dev,old.pdf`,
  ]);
  await importCsv(otherOrgId, [`Other Org,other.${tag}@example.com,Dev,ravi.pdf`, `Other Org,other.${tag}@example.com,QA,secret.pdf`]);
});

after(async () => {
  await prisma.job.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.candidate.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.user.deleteMany({ where: { email: `hr.${tag}@example.com` } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("Resume Parser resume files (throwaway DB)", () => {
  it("match reports what would happen to each file name, case-insensitively", async () => {
    const r = await matchResumeNames(prisma, orgId, ["RAVI.PDF", "asha.pdf", "resume.pdf", "old.pdf", "nobody.pdf", "secret.pdf"]);
    assert.deepEqual(
      r.map((x) => x.status),
      ["ready", "ready", "ambiguous", "has_resume", "no_match", "no_match"],
    );
  });

  it("attaches a resume: private storage, extracted text, timeline event, search embedding", async () => {
    const r = await attachResumeFile(prisma, { organizationId: orgId, name: "Ravi.pdf", type: "application/pdf", buffer: pdf("ravi"), deps });
    assert.deepEqual(r, { name: "Ravi.pdf", status: "attached", parsed: true });
    const ravi = await candidate(orgId, `ravi.${tag}@example.com`);
    assert.match(ravi.resumeUrl ?? "", /^resumes[\\/]/);
    assert.equal(ravi.resumeText, "Resume text of Ravi.pdf");
    assert.deepEqual(embedded, [ravi.id]);
    assert.equal((await storedFiles()).length, 1);
    const events = await prisma.timelineEvent.findMany({
      where: { type: "DOCUMENT_UPLOADED", application: { candidateId: ravi.id } },
    });
    assert.equal(events.length, 1);
    assert.equal((events[0].payload as { parsed: boolean }).parsed, true);

    const other = await candidate(otherOrgId, `other.${tag}@example.com`);
    assert.equal(other.resumeUrl, null, "same file name in another organization is not touched");
  });

  it("the same file again changes nothing", async () => {
    const before = await storedFiles();
    const r = await attachResumeFile(prisma, { organizationId: orgId, name: "ravi.pdf", type: "application/pdf", buffer: pdf("ravi v2"), deps });
    assert.equal(r.status, "has_resume");
    assert.deepEqual(await storedFiles(), before);
  });

  it("rejects fake, wrong-type and path-like files without storing anything", async () => {
    const before = await storedFiles();
    const fake = await attachResumeFile(prisma, { organizationId: orgId, name: "asha.pdf", type: "application/pdf", buffer: Buffer.from("MZ not a pdf"), deps });
    assert.equal(fake.status, "invalid");
    assert.match(fake.reason ?? "", /not a real PDF/);
    assert.equal((await attachResumeFile(prisma, { organizationId: orgId, name: "asha.exe", type: "", buffer: pdf("x"), deps })).status, "invalid");
    assert.equal((await attachResumeFile(prisma, { organizationId: orgId, name: "../asha.pdf", type: "application/pdf", buffer: pdf("x"), deps })).status, "invalid");
    assert.equal((await attachResumeFile(prisma, { organizationId: orgId, name: "asha.pdf", type: "application/pdf", buffer: Buffer.alloc(0), deps })).status, "invalid");
    assert.deepEqual(await storedFiles(), before);
    assert.equal((await candidate(orgId, `asha.${tag}@example.com`)).resumeUrl, null);
  });

  it("matches a URL reference by its file name", async () => {
    const r = await attachResumeFile(prisma, { organizationId: orgId, name: "asha.pdf", type: "application/pdf", buffer: pdf("asha"), deps });
    assert.equal(r.status, "attached");
  });

  it("stores a resume whose text cannot be read, without text", async () => {
    const r = await attachResumeFile(prisma, {
      organizationId: orgId,
      name: "scan.pdf",
      type: "application/pdf",
      buffer: pdf("scan"),
      deps: { ...deps, extractText: async () => { throw new Error("no text layer"); } },
    });
    assert.deepEqual(r, { name: "scan.pdf", status: "attached", parsed: false });
    const scan = await candidate(orgId, `scan.${tag}@example.com`);
    assert.ok(scan.resumeUrl);
    assert.equal(scan.resumeText, null);
  });

  it("never attaches a shared file name or overwrites an existing resume", async () => {
    assert.equal((await attachResumeFile(prisma, { organizationId: orgId, name: "resume.pdf", type: "application/pdf", buffer: pdf("x"), deps })).status, "ambiguous");
    assert.equal((await attachResumeFile(prisma, { organizationId: orgId, name: "old.pdf", type: "application/pdf", buffer: pdf("x"), deps })).status, "has_resume");
    assert.equal((await candidate(orgId, `old.${tag}@example.com`)).resumeUrl, "resumes/kept.pdf");
  });

  it("if a resume appears while uploading, the new file is discarded", async () => {
    const before = await storedFiles();
    const raceId = (await candidate(orgId, `race.${tag}@example.com`)).id;
    const r = await attachResumeFile(prisma, {
      organizationId: orgId,
      name: "race.pdf",
      type: "application/pdf",
      buffer: pdf("race"),
      deps: {
        ...deps,
        extractText: async () => {
          await prisma.candidate.update({ where: { id: raceId }, data: { resumeUrl: "resumes/someone-else.pdf" } });
          return "text";
        },
      },
    });
    assert.equal(r.status, "has_resume");
    assert.deepEqual(await storedFiles(), before);
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: raceId } })).resumeUrl, "resumes/someone-else.pdf");
  });

  it("a search-embedding failure does not undo the attach", async () => {
    await prisma.candidate.update({ where: { id: (await candidate(orgId, `race.${tag}@example.com`)).id }, data: { resumeUrl: null } });
    const r = await attachResumeFile(prisma, {
      organizationId: orgId,
      name: "race.pdf",
      type: "application/pdf",
      buffer: pdf("race"),
      deps: { ...deps, embed: async () => { throw new Error("ollama down"); } },
    });
    assert.equal(r.status, "attached");
  });
});
