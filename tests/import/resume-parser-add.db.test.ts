/**
 * Resume Parser profile → Talent Pool candidate, against a THROWAWAY database.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/resume-parser-add.db.test.ts
 *
 * The database name must end in "_test". Schema must already be pushed there.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { addResumeParserProfile } from "../../src/lib/integrations/resume-parser/add-profile";
import type { ResumeParserClient } from "../../src/lib/integrations/resume-parser/client";
import { resumeParserProfileSchema, type ResumeParserProfile, type ResumeParserResumeFile } from "../../src/lib/integrations/resume-parser/types";
import { extractResumeText } from "../../src/lib/resume/parse";
import type { UploadDeps } from "../../src/lib/resume-upload/upload";

const url = process.env.IMPORT_TEST_DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!dbName.endsWith("_test")) {
  throw new Error("Set IMPORT_TEST_DATABASE_URL to a throwaway database whose name ends in _test.");
}
process.env.DATABASE_URL = url;
const storageRoot = mkdtempSync(path.join(tmpdir(), "hireos-rp-add-"));
process.env.STORAGE_ROOT = storageRoot;

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `rpa${Date.now()}`;
const fixtures = path.join(__dirname, "..", "fixtures", "resumes");
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}`);

const files = new Map<number, ResumeParserResumeFile | null>();
const downloads: number[] = [];
const client: ResumeParserClient = {
  configured: true,
  search: async () => {
    throw new Error("not used");
  },
  getResumeFile: async (id) => {
    downloads.push(id);
    return files.get(id) ?? null;
  },
};
const texts = new Map<string, string>();
const embedded: string[] = [];
const queued: string[] = [];
const deps: UploadDeps = {
  extractText: async ({ buffer }) => {
    const t = texts.get(buffer.toString("latin1"));
    if (t === undefined) throw new Error("Could not extract text");
    return t;
  },
  embed: async (id) => {
    embedded.push(id);
  },
  queueProfile: async (jobs) => {
    queued.push(...jobs.map((j) => j.candidateId));
  },
};

let orgId: string;
let otherOrgId: string;
let userId: string;
let existingId: string;
let otherOrgCandidateId: string;

const profile = (id: number, over: Record<string, unknown> = {}): ResumeParserProfile =>
  resumeParserProfileSchema.parse({
    id,
    name: "Jane Doe",
    email: `jane.${tag}@example.com`,
    phone_numbers: "+1 555 010 2000, +1 555 010 2001",
    location: "Dallas",
    region: "TX",
    linkedin: "https://linkedin.com/in/janedoe",
    total_experience: 8,
    skills: ["AWS", "Django", "Python"],
    matched_skills: ["Python"],
    created_at: "2026-09-14T10:22:31",
    file_name: "Jane_Doe_Resume.pdf",
    ...over,
  });

function pdfFile(id: number, text: string, fileName: string | null = null): void {
  const data = pdf(`profile-${id}`);
  texts.set(data.toString("latin1"), text);
  files.set(id, { fileName, mimeType: "application/pdf", data });
}

const add = (p: ResumeParserProfile, organizationId = orgId) =>
  addResumeParserProfile(prisma, { organizationId, userId, profile: p, client, deps });
const storedFiles = async () => readdir(path.join(storageRoot, "resumes")).catch(() => [] as string[]);
const candidateCount = () => prisma.candidate.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });

before(async () => {
  orgId = (await prisma.organization.create({ data: { name: `RPA ${tag}`, slug: tag } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `RPA other ${tag}`, slug: `${tag}-o` } })).id;
  userId = (
    await prisma.user.create({
      data: { email: `hr.${tag}@example.com`, passwordHash: "x", name: "HR", role: "RECRUITER", organizationId: orgId },
    })
  ).id;
  existingId = (
    await prisma.candidate.create({
      data: { organizationId: orgId, email: `Existing.${tag}@Example.com`, firstName: "Existing", lastName: "Person", phone: "111", skills: ["Kept"] },
    })
  ).id;
  otherOrgCandidateId = (
    await prisma.candidate.create({
      data: { organizationId: otherOrgId, email: `shared.${tag}@example.com`, firstName: "Other", lastName: "Org", phone: "999" },
    })
  ).id;
});

after(async () => {
  await prisma.candidate.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.user.deleteMany({ where: { email: `hr.${tag}@example.com` } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("Add Resume Parser profile to the Talent Pool (throwaway DB)", () => {
  it("creates a Talent Pool candidate with Resume Parser details, the stored resume, local text and a note", async () => {
    pdfFile(1, "Jane Doe\nPython developer\n-- 1 of 1 --");
    const r = await add(profile(1));
    assert.equal(r.status, "created");
    if (r.status !== "created") return;
    assert.equal(r.parsed, true);

    const c = await prisma.candidate.findUniqueOrThrow({
      where: { id: r.candidateId },
      include: { applications: true, notes: true },
    });
    assert.equal(c.organizationId, orgId);
    assert.equal(c.email, `jane.${tag}@example.com`);
    assert.deepEqual([c.firstName, c.lastName], ["Jane", "Doe"]);
    assert.equal(c.phone, "+1 555 010 2000");
    assert.equal(c.experience, 8);
    assert.equal(c.location, "Dallas, TX");
    assert.equal(c.linkedIn, "https://linkedin.com/in/janedoe");
    assert.deepEqual(c.skills, ["AWS", "Django", "Python"]);
    assert.equal(c.resumeText, "Jane Doe\nPython developer");
    assert.ok(c.resumeUrl?.startsWith("resumes/"));
    assert.equal(c.applications.length, 0, "not in hiring");
    assert.equal(c.notes.length, 1);
    assert.equal(c.notes[0].authorId, userId);
    assert.match(c.notes[0].text, /Resume Parser \(profile 1\)/);
    assert.ok(embedded.includes(c.id));
    assert.ok(queued.includes(c.id));
    assert.equal((await storedFiles()).length, 1);
  });

  it("adding the same profile again changes nothing and downloads nothing", async () => {
    const before = downloads.length;
    const count = await candidateCount();
    const r = await add(profile(1));
    assert.equal(r.status, "exists");
    assert.equal(downloads.length, before);
    assert.equal(await candidateCount(), count);
    assert.equal((await storedFiles()).length, 1);
  });

  it("never changes an existing candidate with the same email (any case)", async () => {
    const before = await prisma.candidate.findUniqueOrThrow({ where: { id: existingId } });
    const downloadsBefore = downloads.length;
    const r = await add(profile(2, { email: `EXISTING.${tag}@example.COM`, skills: ["New"] }));
    assert.deepEqual(r, { status: "exists", candidateId: existingId });
    assert.equal(downloads.length, downloadsBefore);
    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: existingId } });
    assert.deepEqual(after, before);
  });

  it("a candidate in another organization does not count, and is not touched", async () => {
    const other = await prisma.candidate.findUniqueOrThrow({ where: { id: otherOrgCandidateId } });
    pdfFile(3, "Shared Person");
    const r = await add(profile(3, { name: "Shared Person", email: `shared.${tag}@example.com` }));
    assert.equal(r.status, "created");
    if (r.status !== "created") return;
    assert.notEqual(r.candidateId, otherOrgCandidateId);
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: r.candidateId } })).organizationId, orgId);
    assert.deepEqual(await prisma.candidate.findUniqueOrThrow({ where: { id: otherOrgCandidateId } }), other);
  });

  it("uses the email in the resume when the profile has none", async () => {
    pdfFile(4, `Ravi Kumar\nravi.${tag}@example.com\nJava`, "ravi.pdf");
    const r = await add(profile(4, { name: "", email: "", file_name: null }));
    assert.equal(r.status, "created");
    if (r.status !== "created") return;
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: r.candidateId } });
    assert.equal(c.email, `ravi.${tag}@example.com`);
    assert.equal(c.firstName, "Ravi");
    assert.match(c.resumeUrl ?? "", /ravi\.pdf$/);
  });

  it("reads an old Word (.doc) resume locally, including the email in its page header", async () => {
    const data = await readFile(path.join(fixtures, "resume-plain.doc"));
    files.set(10, { fileName: null, mimeType: "application/msword", data });
    const r = await addResumeParserProfile(prisma, {
      organizationId: orgId,
      userId,
      profile: profile(10, { name: "", email: "", file_name: "Ravi_Kumar_Old.doc" }),
      client,
      deps: { ...deps, extractText: extractResumeText },
    });
    assert.equal(r.status, "created");
    if (r.status !== "created") return;
    assert.equal(r.parsed, true);
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: r.candidateId } });
    assert.equal(c.email, "ravi.kumar.doc@example.com");
    assert.deepEqual([c.firstName, c.lastName], ["Ravi", "Kumar"]);
    assert.match(c.resumeText ?? "", /Senior Java Developer/);
    assert.doesNotMatch(c.resumeText ?? "", /HYPERLINK/);
    assert.match(c.resumeUrl ?? "", /Ravi_Kumar_Old\.doc$/);
  });

  it("keeps a password-protected .doc but marks it as not read", async () => {
    const data = await readFile(path.join(fixtures, "resume-locked.doc"));
    files.set(11, { fileName: "locked.doc", mimeType: "application/msword", data });
    const r = await addResumeParserProfile(prisma, {
      organizationId: orgId,
      userId,
      profile: profile(11, { name: "Locked File", email: `locked.${tag}@example.com`, file_name: "locked.doc" }),
      client,
      deps: { ...deps, extractText: extractResumeText },
    });
    assert.equal(r.status, "created");
    if (r.status !== "created") return;
    assert.equal(r.parsed, false);
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: r.candidateId } });
    assert.equal(c.resumeText, null);
  });

  it("refuses profiles it cannot add, and stores nothing", async () => {
    const count = await candidateCount();
    const stored = (await storedFiles()).length;

    pdfFile(5, "No contact details here");
    assert.deepEqual(await add(profile(5, { email: "" })), { status: "no_email" });

    files.set(6, null);
    assert.deepEqual(await add(profile(6, { email: `nofile.${tag}@example.com` })), { status: "no_file" });

    files.set(7, { fileName: "old.doc", mimeType: "application/msword", data: Buffer.from("\xD0\xCF\x11\xE0 not word", "latin1") });
    const doc = await add(profile(7, { email: `doc.${tag}@example.com`, file_name: "old.doc" }));
    assert.deepEqual(doc, { status: "invalid_file", reason: "file content is not a real DOC" });

    files.set(8, { fileName: "fake.pdf", mimeType: "application/pdf", data: Buffer.from("MZ not a pdf") });
    const fake = await add(profile(8, { email: `fake.${tag}@example.com`, file_name: "fake.pdf" }));
    assert.equal(fake.status, "invalid_file");

    assert.equal(await candidateCount(), count);
    assert.equal((await storedFiles()).length, stored);
  });

  it("two people adding the same profile at once create one candidate", async () => {
    pdfFile(9, "Twin Click");
    const p = profile(9, { name: "Twin Click", email: `twin.${tag}@example.com` });
    const results = await Promise.all([add(p), add(p)]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["created", "exists"]);
    const ids = new Set(results.map((r) => ("candidateId" in r ? r.candidateId : "")));
    assert.equal(ids.size, 1);
    assert.equal(await prisma.candidate.count({ where: { organizationId: orgId, email: `twin.${tag}@example.com` } }), 1);
  });
});
