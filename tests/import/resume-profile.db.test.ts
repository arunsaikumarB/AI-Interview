/**
 * Deep resume reading (rules + OCR + background AI), against a THROWAWAY database.
 *
 *   IMPORT_TEST_DATABASE_URL=postgresql://.../hireos_import_test npx tsx --test tests/import/resume-profile.db.test.ts
 *
 * The database name must end in "_test". Schema must already be pushed there.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const url = process.env.IMPORT_TEST_DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!dbName.endsWith("_test")) {
  throw new Error("Set IMPORT_TEST_DATABASE_URL to a throwaway database whose name ends in _test.");
}
process.env.DATABASE_URL = url;
const storageRoot = mkdtempSync(path.join(tmpdir(), "hireos-resume-profile-"));
process.env.STORAGE_ROOT = storageRoot;

import { ocrUploadedResume, readUploadedResume, saveUploadedResume, type ProfileJobInput, type UploadDeps } from "../../src/lib/resume-upload/upload";
import { uploadRowSchema, type UploadRow } from "../../src/lib/resume-upload/constants";
import {
  MAX_PROFILE_ATTEMPTS,
  enqueueProfileJobs,
  fillEmptyProfile,
  kickProfileWorker,
  processNextProfileJob,
  profileJobStatus,
  type ProfileWorkerDeps,
} from "../../src/lib/resume-upload/profile-queue";
import type { AiProfile } from "../../src/lib/resume-upload/ai-profile";
import { readStoredFile, saveUpload } from "../../src/lib/storage";

const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = `rp${Date.now()}`;
const PDF = "application/pdf";
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}`);
const texts = new Map<string, string>();
const queued: ProfileJobInput[] = [];
const deps: UploadDeps = {
  extractText: async ({ fileName }) => texts.get(fileName) ?? "",
  embed: async () => undefined,
  queueProfile: async (jobs) => {
    queued.push(...jobs);
  },
};
let orgId: string;
let otherOrgId: string;

const row = (fileName: string, email: string, extra: Partial<UploadRow> = {}): UploadRow =>
  uploadRowSchema.parse({ fileName, firstName: "Test", lastName: "Person", email, phone: "", experience: null, ...extra });

const RESUME = [
  "BHAVANI DASARI",
  "Hyderabad, Telangana | bhavani@example.com",
  "linkedin.com/in/bhavani-dasari",
  "PROFESSIONAL SUMMARY",
  "Java developer with hands-on experience building REST APIs with Spring Boot and microservices on AWS.",
  "TECHNICAL SKILLS",
  "Languages: Java, Python, SQL",
  "Cloud: AWS (EC2, S3), Docker",
  "EDUCATION",
  "B.Tech in Computer Science, JNTU College of Engineering, 2017 – 2021",
  "CERTIFICATIONS",
  "AWS Certified Cloud Practitioner",
].join("\n");

const emptyAi: AiProfile = {
  location: "",
  linkedIn: "",
  summary: "",
  skills: [],
  experienceYears: null,
  education: [],
  certifications: [],
};

class Transient extends Error {}

function workerDeps(file: string, over: Partial<ProfileWorkerDeps> = {}): ProfileWorkerDeps {
  return {
    db: prisma,
    queueFile: file,
    aiProfile: async () => emptyAi,
    readResume: readStoredFile,
    extractText: async () => "",
    ocr: async () => "",
    embed: async () => undefined,
    isTransient: (err) => err instanceof Transient,
    errorCode: (err) => (err instanceof Transient ? "OLLAMA_UNREACHABLE" : "VALIDATION"),
    liveInterviews: async () => 0,
    sleep: async () => undefined,
    ...over,
  };
}

async function newCandidate(email: string, data: Record<string, unknown> = {}) {
  return prisma.candidate.create({
    data: { organizationId: orgId, email: `${email}.${tag}@example.com`, firstName: "Kept", lastName: "Name", phone: "9876543210", ...data },
  });
}

before(async () => {
  orgId = (await prisma.organization.create({ data: { name: `RP ${tag}`, slug: tag } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `RP other ${tag}`, slug: `${tag}-o` } })).id;
});

after(async () => {
  await prisma.candidate.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("Save stores what the rules read and queues background reading", () => {
  it("a new candidate gets skills, education, certifications, summary, LinkedIn and location", async () => {
    texts.set("deep.pdf", RESUME);
    queued.length = 0;
    const r = await saveUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      row: row("deep.pdf", `deep.${tag}@example.com`, { experience: 4 }),
      type: PDF,
      buffer: pdf("deep"),
      deps,
    });
    assert.equal(r.status, "created");
    const c = await prisma.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: `deep.${tag}@example.com` } });
    for (const s of ["Java", "Python", "SQL", "AWS", "EC2", "S3", "Docker"]) assert.ok(c.skills.includes(s), s);
    assert.equal((c.education as unknown[]).length, 1);
    assert.deepEqual(c.certifications, ["AWS Certified Cloud Practitioner"]);
    assert.equal(c.linkedIn, "https://www.linkedin.com/in/bhavani-dasari");
    assert.match(c.location ?? "", /Hyderabad/);
    assert.match(c.summary ?? "", /^Java developer/);
    assert.equal(c.experience, 4);
    assert.deepEqual(queued, [{ candidateId: c.id, organizationId: orgId, experienceSet: true }]);
  });

  it("an existing candidate is not queued or changed", async () => {
    queued.length = 0;
    const r = await saveUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      row: row("deep.pdf", `deep.${tag}@example.com`),
      type: PDF,
      buffer: pdf("deep"),
      deps,
    });
    assert.equal(r.status, "exists");
    assert.deepEqual(queued, []);
  });

  it("a failing queue does not undo the save", async () => {
    texts.set("q.pdf", "Some text");
    const r = await saveUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      row: row("q.pdf", `q.${tag}@example.com`),
      type: PDF,
      buffer: pdf("q"),
      deps: { ...deps, queueProfile: async () => { throw new Error("disk full"); } },
    });
    assert.equal(r.status, "created");
  });
});

describe("OCR pass for scanned or damaged PDFs", () => {
  it("read flags damaged and scanned PDFs; OCR fixes cut-off email and Save stores the OCR text", async () => {
    texts.set("cut.pdf", `Seetharam Reddy\nseetharam.${tag}@gmail.co\nSKILLS\nFigm`);
    const buffer = pdf("cut");
    const read = await readUploadedResume(prisma, { organizationId: orgId, jobId: null, name: "cut.pdf", type: PDF, buffer, deps });
    assert.ok(read.status !== "invalid" && read.needsOcr, "cut-off email asks for OCR");
    const scanned = await readUploadedResume(prisma, { organizationId: orgId, jobId: null, name: "scan.pdf", type: PDF, buffer: pdf("s"), deps });
    assert.ok(scanned.status !== "invalid" && scanned.needsOcr, "no text asks for OCR");
    texts.set("fine.pdf", `Asha Rao\nasha.${tag}@example.com\n9876543210`);
    const fine = await readUploadedResume(prisma, { organizationId: orgId, jobId: null, name: "fine.pdf", type: PDF, buffer: pdf("f"), deps });
    assert.ok(fine.status !== "invalid" && !fine.needsOcr, "a clean PDF is not OCR'd");

    const ocrText = `Seetharami Reddy\nseetharam.${tag}@gmail.com\n+91 98765 43210\nSKILLS\nFigma, Sketch, Adobe XD`;
    const ocr = await ocrUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      name: "cut.pdf",
      type: PDF,
      buffer,
      deps: { extractText: deps.extractText, ocr: async () => ocrText },
    });
    if (ocr.status === "invalid") throw new Error("OCR read should succeed");
    assert.equal(ocr.ocr, true);
    assert.equal(ocr.fields.email, `seetharam.${tag}@gmail.com`, "OCR email replaces the cut-off one");
    assert.equal(ocr.fields.phone, "+91 98765 43210");
    assert.equal(ocr.profile.skills, 3);

    const r = await saveUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      row: row("cut.pdf", ocr.fields.email, { firstName: "Seetharami", lastName: "Reddy" }),
      type: PDF,
      buffer,
      deps,
    });
    assert.equal(r.status, "created");
    const c = await prisma.candidate.findFirstOrThrow({ where: { organizationId: orgId, email: `seetharam.${tag}@gmail.com` } });
    assert.equal(c.resumeText, ocrText, "Save uses the OCR text, not the damaged PDF text");
    assert.deepEqual(c.skills, ["Figma", "Sketch", "Adobe XD"]);
  });

  it("OCR text from one organization is never used for another", async () => {
    const buffer = pdf("shared-file");
    await ocrUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      name: "shared.pdf",
      type: PDF,
      buffer,
      deps: { extractText: async () => "", ocr: async () => "SECRET ORG A TEXT" },
    });
    await saveUploadedResume(prisma, {
      organizationId: otherOrgId,
      jobId: null,
      row: row("shared.pdf", `shared.${tag}@example.com`),
      type: PDF,
      buffer,
      deps,
    });
    const c = await prisma.candidate.findFirstOrThrow({ where: { organizationId: otherOrgId, email: `shared.${tag}@example.com` } });
    assert.equal(c.resumeText, null);
  });

  it("only PDFs can be scanned; failed OCR keeps the PDF's own reading", async () => {
    const txt = await ocrUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      name: "cv.txt",
      type: "text/plain",
      buffer: Buffer.from("Plain text resume"),
      deps: { extractText: async () => "Plain text resume", ocr: async () => "x" },
    });
    assert.deepEqual(txt, { name: "cv.txt", status: "invalid", reason: "only PDF files can be scanned" });
    texts.set("broken.pdf", `Ravi Kumar\nravi.${tag}@example.com`);
    const failed = await ocrUploadedResume(prisma, {
      organizationId: orgId,
      jobId: null,
      name: "broken.pdf",
      type: PDF,
      buffer: pdf("broken"),
      deps: { extractText: deps.extractText, ocr: async () => { throw new Error("timeout"); } },
    });
    assert.ok(failed.status !== "invalid" && failed.ocr === false && failed.fields.email === `ravi.${tag}@example.com`);
  });
});

describe("fillEmptyProfile never overwrites", () => {
  it("fills only empty fields and leaves HR values and experience alone", async () => {
    const c = await newCandidate("fill", { location: "Chennai", skills: ["Go"], experience: 2 });
    const filled = await fillEmptyProfile(
      prisma,
      c.id,
      orgId,
      {
        location: "Pune",
        linkedIn: "https://www.linkedin.com/in/x-y",
        summary: "Backend engineer.",
        skills: ["Java"],
        education: [{ degree: "MCA", institution: "Osmania University", year: "2019" }],
        certifications: ["CKA"],
        experienceYears: 9,
      },
      false,
    );
    assert.deepEqual(filled.sort(), ["certifications", "education", "linkedIn", "summary"]);
    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.location, "Chennai");
    assert.deepEqual(after.skills, ["Go"]);
    assert.equal(after.experience, 2);
    assert.equal(after.linkedIn, "https://www.linkedin.com/in/x-y");
  });

  it("never writes to another organization's candidate", async () => {
    const other = await prisma.candidate.create({
      data: { organizationId: otherOrgId, email: `other.${tag}@example.com`, firstName: "O", lastName: "Org" },
    });
    const filled = await fillEmptyProfile(prisma, other.id, orgId, { ...emptyAi, location: "Pune", skills: ["Java"] }, false);
    assert.deepEqual(filled, []);
    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: other.id } });
    assert.equal(after.location, null);
    assert.deepEqual(after.skills, []);
  });
});

describe("Background worker (fake AI)", () => {
  const file = path.join(storageRoot, "queue", "test-queue.json");

  it("fills empty fields from the AI, never touches name/email/phone, re-embeds", async () => {
    const c = await newCandidate("ai", { resumeText: "Resume text", experience: 0 });
    const embedded: string[] = [];
    await enqueueProfileJobs(file, [{ candidateId: c.id, organizationId: orgId, experienceSet: false }]);
    const r = await processNextProfileJob(
      workerDeps(file, {
        aiProfile: async () => ({ ...emptyAi, location: "Vizag", skills: ["Kotlin"], experienceYears: 3 }),
        embed: async (id) => {
          embedded.push(id);
        },
      }),
    );
    assert.equal(r.kind, "ran");
    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.location, "Vizag");
    assert.deepEqual(after.skills, ["Kotlin"]);
    assert.equal(after.experience, 3);
    assert.equal(after.firstName, "Kept");
    assert.equal(after.email, c.email);
    assert.equal(after.phone, "9876543210");
    assert.deepEqual(embedded, [c.id]);
    assert.equal((await profileJobStatus(file, c.id, orgId))?.status, "done");
  });

  it("does not set experience when HR saved one (experienceSet)", async () => {
    const c = await newCandidate("expset", { resumeText: "Resume text", experience: 0 });
    await enqueueProfileJobs(file, [{ candidateId: c.id, organizationId: orgId, experienceSet: true }]);
    await processNextProfileJob(workerDeps(file, { aiProfile: async () => ({ ...emptyAi, experienceYears: 7 }) }));
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: c.id } })).experience, 0);
  });

  it(`retries an unreachable AI at most ${MAX_PROFILE_ATTEMPTS} times, then records an honest failure`, async () => {
    const c = await newCandidate("retry", { resumeText: "Resume text" });
    await enqueueProfileJobs(file, [{ candidateId: c.id, organizationId: orgId, experienceSet: false }]);
    let calls = 0;
    let clock = Date.now();
    const d = workerDeps(file, {
      now: () => clock,
      aiProfile: async () => {
        calls++;
        throw new Transient("down");
      },
    });
    for (let i = 0; i < 10; i++) {
      const r = await processNextProfileJob(d);
      if (r.kind === "idle") break;
      clock += 10 * 60_000;
    }
    assert.equal(calls, MAX_PROFILE_ATTEMPTS);
    assert.deepEqual(await profileJobStatus(file, c.id, orgId), { status: "failed", error: "OLLAMA_UNREACHABLE" });
    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: c.id } });
    assert.deepEqual(after.skills, []);
    assert.equal(after.location, null);
  });

  it("a bad AI answer fails at once without retrying", async () => {
    const c = await newCandidate("bad", { resumeText: "Resume text" });
    await enqueueProfileJobs(file, [{ candidateId: c.id, organizationId: orgId, experienceSet: false }]);
    let calls = 0;
    await processNextProfileJob(
      workerDeps(file, {
        aiProfile: async () => {
          calls++;
          throw new Error("invalid json");
        },
      }),
    );
    assert.equal(calls, 1);
    assert.equal((await profileJobStatus(file, c.id, orgId))?.status, "failed");
  });

  it("runs OCR when the stored resume has no text, then saves the text and rule-based fields", async () => {
    const stored = await saveUpload({ category: "resumes", originalName: "scan.pdf", data: pdf("scanned") });
    const c = await newCandidate("ocr", { resumeUrl: stored.relativePath });
    await enqueueProfileJobs(file, [{ candidateId: c.id, organizationId: orgId, experienceSet: false }]);
    let ocrCalls = 0;
    await processNextProfileJob(
      workerDeps(file, {
        ocr: async () => {
          ocrCalls++;
          return "SKILLS\nJava, Spring Boot\nLocation: Guntur, Andhra Pradesh";
        },
      }),
    );
    assert.equal(ocrCalls, 1);
    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: c.id } });
    assert.match(after.resumeText ?? "", /Java, Spring Boot/);
    assert.deepEqual(after.skills, ["Java", "Spring Boot"]);
    assert.match(after.location ?? "", /Guntur/);
  });

  it("no readable text even with OCR is an honest failure", async () => {
    const stored = await saveUpload({ category: "resumes", originalName: "blank.pdf", data: pdf("blank") });
    const c = await newCandidate("blank", { resumeUrl: stored.relativePath });
    await enqueueProfileJobs(file, [{ candidateId: c.id, organizationId: orgId, experienceSet: false }]);
    await processNextProfileJob(workerDeps(file));
    assert.deepEqual(await profileJobStatus(file, c.id, orgId), { status: "failed", error: "no_readable_text" });
  });

  it("a job naming another organization's candidate does nothing", async () => {
    const other = await prisma.candidate.create({
      data: { organizationId: otherOrgId, email: `other2.${tag}@example.com`, firstName: "O", lastName: "Org", resumeText: "x" },
    });
    let aiCalls = 0;
    await enqueueProfileJobs(file, [{ candidateId: other.id, organizationId: orgId, experienceSet: false }]);
    await processNextProfileJob(
      workerDeps(file, {
        aiProfile: async () => {
          aiCalls++;
          return { ...emptyAi, location: "Pune" };
        },
      }),
    );
    assert.equal(aiCalls, 0);
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: other.id } })).location, null);
  });

  it("the worker waits while a live interview is running, then finishes the queue", async () => {
    const c = await newCandidate("live", { resumeText: "Resume text" });
    await enqueueProfileJobs(file, [{ candidateId: c.id, organizationId: orgId, experienceSet: false }]);
    let live = 1;
    let waits = 0;
    let aiCalls = 0;
    kickProfileWorker(async () =>
      workerDeps(file, {
        liveInterviews: async () => live,
        sleep: async () => {
          waits++;
          live = 0;
        },
        aiProfile: async () => {
          aiCalls++;
          assert.equal(live, 0, "AI never runs during a live interview");
          return { ...emptyAi, location: "Nellore" };
        },
      }),
    );
    for (let i = 0; i < 50 && (await profileJobStatus(file, c.id, orgId))?.status !== "done"; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal((await profileJobStatus(file, c.id, orgId))?.status, "done");
    assert.ok(waits >= 1);
    assert.equal(aiCalls, 1);
    assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id: c.id } })).location, "Nellore");
  });
});
