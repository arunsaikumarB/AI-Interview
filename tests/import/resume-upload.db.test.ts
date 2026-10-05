/**
 * HR resume upload (one candidate per file), against a THROWAWAY database.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/resume-upload.db.test.ts
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
import { readUploadedResume, saveUploadedResume, type UploadDeps } from "../../src/lib/resume-upload/upload";
import { uploadRowSchema, type UploadRow } from "../../src/lib/resume-upload/constants";

const url = process.env.IMPORT_TEST_DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!dbName.endsWith("_test")) {
  throw new Error("Set IMPORT_TEST_DATABASE_URL to a throwaway database whose name ends in _test.");
}
process.env.DATABASE_URL = url;
const storageRoot = mkdtempSync(path.join(tmpdir(), "hireos-resume-upload-"));
process.env.STORAGE_ROOT = storageRoot;

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `ru${Date.now()}`;
const PDF = "application/pdf";
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}`);
const embedded: string[] = [];
const texts = new Map<string, string>();
const deps: UploadDeps = {
  extractText: async ({ fileName }) => {
    const t = texts.get(fileName);
    if (t === undefined) throw new Error("Could not extract text from this PDF");
    return t;
  },
  embed: async (id) => {
    embedded.push(id);
  },
};
let orgId: string;
let otherOrgId: string;
let jobId: string;
let otherJobId: string;

const row = (fileName: string, email: string, extra: Partial<UploadRow> = {}): UploadRow =>
  uploadRowSchema.parse({ fileName, firstName: "Test", lastName: "Person", email, phone: "", experience: null, ...extra });
const save = (r: UploadRow, opts: { jobId?: string | null; organizationId?: string; buffer?: Buffer; type?: string } = {}) =>
  saveUploadedResume(prisma, {
    organizationId: opts.organizationId ?? orgId,
    jobId: opts.jobId ?? null,
    row: r,
    type: opts.type ?? PDF,
    buffer: opts.buffer ?? pdf(r.fileName),
    deps,
  });
const storedFiles = async () => readdir(path.join(storageRoot, "resumes")).catch(() => [] as string[]);

before(async () => {
  orgId = (await prisma.organization.create({ data: { name: `RU ${tag}`, slug: tag } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `RU other ${tag}`, slug: `${tag}-o` } })).id;
  const user = await prisma.user.create({
    data: { email: `hr.${tag}@example.com`, passwordHash: "x", name: "HR", role: "HR_ADMIN", organizationId: orgId },
  });
  jobId = (
    await prisma.job.create({ data: { organizationId: orgId, title: "Java Developer", description: "d", status: "DRAFT", createdById: user.id } })
  ).id;
  otherJobId = (
    await prisma.job.create({ data: { organizationId: otherOrgId, title: "Secret", description: "d", status: "OPEN", createdById: user.id } })
  ).id;
  await prisma.candidate.create({
    data: { organizationId: orgId, email: `Existing.${tag}@Example.com`, firstName: "Existing", lastName: "Person", phone: "111", resumeUrl: "resumes/kept.pdf" },
  });
  await prisma.candidate.create({
    data: { organizationId: otherOrgId, email: `other.${tag}@example.com`, firstName: "Other", lastName: "Org" },
  });
});

after(async () => {
  await prisma.job.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.candidate.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.user.deleteMany({ where: { email: `hr.${tag}@example.com` } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("Resume upload (throwaway DB)", () => {
  it("read suggests details and says what saving would do, without writing anything", async () => {
    texts.set("asha.pdf", `Asha Rao\nasha.${tag}@example.com\n9876543210\n4 years of experience`);
    texts.set("existing.pdf", `Existing Person\nexisting.${tag}@example.com`);
    texts.set("other.pdf", `Other Org\nother.${tag}@example.com`);
    const before = await prisma.candidate.count({ where: { organizationId: orgId } });
    const read = (name: string, jobIdArg: string | null = null, buffer = pdf(name)) =>
      readUploadedResume(prisma, { organizationId: orgId, jobId: jobIdArg, name, type: PDF, buffer, deps });

    const asha = await read("asha.pdf");
    assert.equal(asha.status, "new");
    assert.deepEqual(asha.fields, {
      firstName: "Asha",
      lastName: "Rao",
      email: `asha.${tag}@example.com`,
      phone: "9876543210",
      experience: 4,
    });
    assert.equal(asha.parsed, true);
    assert.equal((await read("existing.pdf")).status, "exists");
    assert.equal((await read("existing.pdf", jobId)).status, "link");
    assert.equal((await read("other.pdf")).status, "new", "a candidate in another organization is not visible");
    const scanned = await read("Ravi_Kumar_Resume.pdf");
    assert.equal(scanned.status, "new");
    assert.equal(scanned.parsed, false);
    assert.equal(`${scanned.fields.firstName} ${scanned.fields.lastName}`, "Ravi Kumar");
    assert.equal(scanned.fields.email, "");
    assert.deepEqual(await read("fake.pdf", null, Buffer.from("MZ not a pdf")), {
      name: "fake.pdf",
      status: "invalid",
      reason: "file content is not a real PDF",
    });
    assert.equal(await prisma.candidate.count({ where: { organizationId: orgId } }), before);
    assert.deepEqual(await storedFiles(), []);
  });

  it("save without a job creates a talent-pool candidate with the reviewed details and resume", async () => {
    texts.set("asha.pdf", "Asha Rao resume text");
    const r = await save(row("asha.pdf", `Asha.${tag}@Example.com`, { firstName: "Asha", lastName: "Rao", phone: "+91 98765 43210", experience: 4 }));
    assert.deepEqual(r, { name: "asha.pdf", status: "created", parsed: true });
    const c = await prisma.candidate.findFirstOrThrow({
      where: { organizationId: orgId, email: `asha.${tag}@example.com` },
      include: { applications: true },
    });
    assert.equal(c.firstName, "Asha");
    assert.equal(c.phone, "+91 98765 43210");
    assert.equal(c.experience, 4);
    assert.equal(c.resumeText, "Asha Rao resume text");
    assert.match(c.resumeUrl ?? "", /^resumes\//);
    assert.equal(c.applications.length, 0);
    assert.ok(embedded.includes(c.id));
    assert.equal((await storedFiles()).length, 1);
  });

  it("uploading the same resume again changes nothing", async () => {
    const r = await save(row("asha.pdf", `asha.${tag}@example.com`, { firstName: "Changed" }));
    assert.equal(r.status, "exists");
    const c = await prisma.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: `asha.${tag}@example.com` } });
    assert.equal(c.firstName, "Asha");
    assert.equal((await storedFiles()).length, 1);
  });

  it("save with a job creates candidate + application at Applied/Active with timeline events", async () => {
    texts.set("kiran.pdf", "Kiran resume");
    const r = await save(row("kiran.pdf", `kiran.${tag}@example.com`, { firstName: "Kiran" }), { jobId });
    assert.equal(r.status, "created");
    const c = await prisma.candidate.findFirstOrThrow({
      where: { organizationId: orgId, email: `kiran.${tag}@example.com` },
      include: { applications: { include: { timelineEvents: true } } },
    });
    assert.equal(c.applications.length, 1);
    const app = c.applications[0];
    assert.equal(app.jobId, jobId);
    assert.equal(app.stage, "APPLIED");
    assert.equal(app.status, "ACTIVE");
    assert.equal(app.source, "resume_upload");
    assert.deepEqual(app.timelineEvents.map((e) => e.type).sort(), ["APPLICATION_CREATED", "DOCUMENT_UPLOADED"]);
  });

  it("an existing candidate (any email case) is linked to the job but never changed", async () => {
    const r = await save(row("existing.pdf", `existing.${tag}@example.com`, { firstName: "Overwrite", phone: "999" }), { jobId });
    assert.equal(r.status, "linked");
    const c = await prisma.candidate.findFirstOrThrow({
      where: { organizationId: orgId, email: `Existing.${tag}@Example.com` },
      include: { applications: true },
    });
    assert.equal(c.firstName, "Existing");
    assert.equal(c.phone, "111");
    assert.equal(c.resumeUrl, "resumes/kept.pdf");
    assert.equal(c.applications.length, 1);
    assert.equal(c.applications[0].source, "resume_upload");
    assert.equal((await save(row("existing.pdf", `existing.${tag}@example.com`), { jobId })).status, "already_applied");
    assert.equal(await prisma.candidate.count({ where: { organizationId: orgId, email: { contains: `existing.${tag}`, mode: "insensitive" } } }), 1);
  });

  it("a resume with no readable text is still saved, without text or embedding", async () => {
    embedded.length = 0;
    const r = await save(row("scan.pdf", `scan.${tag}@example.com`));
    assert.deepEqual(r, { name: "scan.pdf", status: "created", parsed: false });
    const c = await prisma.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: `scan.${tag}@example.com` } });
    assert.equal(c.resumeText, null);
    assert.ok(c.resumeUrl);
    assert.deepEqual(embedded, []);
  });

  it("a scanned PDF whose only text is page markers counts as unreadable; markers are not stored", async () => {
    texts.set("markers.pdf", "-- 1 of 2 --\n\n-- 2 of 2 --");
    const read = await readUploadedResume(prisma, { organizationId: orgId, jobId: null, name: "markers.pdf", type: PDF, buffer: pdf("m"), deps });
    assert.equal(read.status !== "invalid" && read.parsed, false);
    texts.set("paged.pdf", "Real text\n-- 1 of 1 --");
    assert.equal((await save(row("paged.pdf", `paged.${tag}@example.com`))).status, "created");
    const c = await prisma.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: `paged.${tag}@example.com` } });
    assert.equal(c.resumeText, "Real text");
  });

  it("rejects unsafe or fake files and stores nothing", async () => {
    const files = (await storedFiles()).length;
    const bad = [
      await save(row("../evil.pdf", `e1.${tag}@example.com`)),
      await save(row("tool.exe", `e2.${tag}@example.com`), { type: "application/octet-stream" }),
      await save(row("fake.pdf", `e3.${tag}@example.com`), { buffer: Buffer.from("MZ") }),
      await save(row("empty.pdf", `e4.${tag}@example.com`), { buffer: Buffer.alloc(0) }),
    ];
    assert.deepEqual(bad.map((b) => b.status), ["invalid", "invalid", "invalid", "invalid"]);
    assert.equal((await storedFiles()).length, files);
    assert.equal(await prisma.candidate.count({ where: { organizationId: orgId, email: { startsWith: "e" , endsWith: `${tag}@example.com` } } }), 0);
  });

  it("the same email in another organization is a separate candidate there", async () => {
    texts.set("other.pdf", "x");
    const r = await save(row("other.pdf", `other.${tag}@example.com`, { firstName: "Mine" }));
    assert.equal(r.status, "created");
    const other = await prisma.candidate.findFirstOrThrow({ where: { organizationId: otherOrgId, email: `other.${tag}@example.com` } });
    assert.equal(other.firstName, "Other");
    assert.equal(await prisma.application.count({ where: { jobId: otherJobId } }), 0);
  });

  it("concurrent saves of the same new email create exactly one candidate and keep one file", async () => {
    texts.set("race.pdf", "race");
    const files = (await storedFiles()).length;
    const results = await Promise.all([1, 2, 3].map(() => save(row("race.pdf", `race.${tag}@example.com`))));
    assert.equal(results.filter((r) => r.status === "created").length, 1);
    assert.equal(results.filter((r) => r.status === "exists").length, 2);
    assert.equal(await prisma.candidate.count({ where: { organizationId: orgId, email: `race.${tag}@example.com` } }), 1);
    assert.equal((await storedFiles()).length, files + 1);
  });

  it("an embedding failure does not undo the save", async () => {
    texts.set("emb.pdf", "text");
    const r = await saveUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      row: row("emb.pdf", `emb.${tag}@example.com`),
      type: PDF,
      buffer: pdf("emb"),
      deps: { ...deps, embed: async () => { throw new Error("ollama down"); } },
    });
    assert.equal(r.status, "created");
  });
});
