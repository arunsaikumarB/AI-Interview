import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractResumeProfile } from "../../src/lib/resume-upload/profile";
import { sanitizeAiProfile, aiProfileUserPrompt } from "../../src/lib/resume-upload/ai-profile";
import { recallOcrText, rememberOcrText } from "../../src/lib/resume-upload/text-cache";
import {
  enqueueProfileJobs,
  profileJobStatus,
  recoverProfileJobs,
} from "../../src/lib/resume-upload/profile-queue";
import { formatCertifications, safeLinkedInHref } from "../../src/lib/candidate-detail-ui";

const NOW = new Date("2026-10-05T00:00:00Z");

const TYPICAL = [
  "BHAVANI DASARI",
  "Hyderabad, Telangana | bhavani@example.com | +91 98765 43210",
  "linkedin.com/in/bhavani-dasari",
  "PROFESSIONAL SUMMARY",
  "Java developer with hands-on experience building REST APIs with Spring Boot and",
  "microservices, deployed on AWS. Comfortable with CI/CD and agile teams.",
  "TECHNICAL SKILLS",
  "Languages: Java, Python, SQL",
  "Frameworks: Spring Boot, Hibernate, React",
  "Cloud: AWS (EC2, S3, Lambda), Docker",
  "WORK EXPERIENCE",
  "Software Engineer, Acme Solutions — Jan 2022 – Present",
  "Built payment services.",
  "Intern, Beta Labs — Jun 2021 – Dec 2021",
  "EDUCATION",
  "B.Tech in Computer Science, JNTU College of Engineering, 2017 – 2021",
  "CERTIFICATIONS",
  "AWS Certified Cloud Practitioner",
  "Oracle Certified Java Programmer",
].join("\n");

describe("extractResumeProfile (rule-based deep reader)", () => {
  it("reads skills, education, certifications, summary, LinkedIn, location and work years", () => {
    const p = extractResumeProfile(TYPICAL, NOW);
    for (const s of ["Java", "Python", "SQL", "Spring Boot", "Hibernate", "React", "AWS", "EC2", "S3", "Docker"]) {
      assert.ok(p.skills.includes(s), `skill ${s} in ${JSON.stringify(p.skills)}`);
    }
    assert.ok(!p.skills.some((s) => /languages|frameworks|cloud/i.test(s)), "category labels are not skills");
    assert.equal(p.education.length, 1);
    assert.match(p.education[0].degree, /B\.Tech/);
    assert.match(p.education[0].institution, /JNTU/);
    assert.match(p.education[0].year, /2017/);
    assert.deepEqual(p.certifications, ["AWS Certified Cloud Practitioner", "Oracle Certified Java Programmer"]);
    assert.match(p.summary, /^Java developer .* agile teams\.$/);
    assert.equal(p.linkedIn, "https://www.linkedin.com/in/bhavani-dasari");
    assert.match(p.location, /Hyderabad/);
    assert.ok(p.experienceYears !== null && p.experienceYears >= 4.5 && p.experienceYears <= 5, `years ${p.experienceYears}`);
  });

  it("returns empty values for text with nothing to read, never invents", () => {
    const p = extractResumeProfile("hello\nworld", NOW);
    assert.deepEqual(p, {
      location: "",
      linkedIn: "",
      summary: "",
      skills: [],
      education: [],
      certifications: [],
      experienceYears: null,
    });
  });

  it("does not count truncated years (broken PDF text layer) as experience", () => {
    const p = extractResumeProfile("EXPERIENCE\nDeveloper, X Corp, Aug 202 – Presen", NOW);
    assert.equal(p.experienceYears, null);
  });
});

describe("sanitizeAiProfile", () => {
  const base = {
    location: "",
    linkedIn: "",
    summary: "",
    skills: [] as string[],
    totalExperienceYears: null as number | null,
    education: [] as Array<{ degree: string; institution: string; year: string }>,
    certifications: [] as string[],
  };

  it("drops placeholders, bad URLs, bad locations and impossible years", () => {
    const p = sanitizeAiProfile({
      ...base,
      location: "Not specified",
      linkedIn: "javascript:alert(1)",
      summary: "N/A",
      totalExperienceYears: 120,
    });
    assert.equal(p.location, "");
    assert.equal(p.linkedIn, "");
    assert.equal(p.summary, "");
    assert.equal(p.experienceYears, null);
    assert.equal(sanitizeAiProfile({ ...base, location: "a@b.com 500081" }).location, "");
    assert.equal(sanitizeAiProfile({ ...base, totalExperienceYears: 0 }).experienceYears, null);
  });

  it("normalizes LinkedIn, rounds years, dedupes certifications against skills", () => {
    const p = sanitizeAiProfile({
      ...base,
      location: "Pune, Maharashtra",
      linkedIn: "www.linkedin.com/in/ravi-k?trk=x",
      totalExperienceYears: 4.56,
      skills: ["Java", "java", "AWS"],
      certifications: ["AWS", "Azure Fundamentals AZ-900", "azure fundamentals az-900"],
      education: [{ degree: "MBA", institution: "", year: "" }, { degree: "", institution: "", year: "2020" }],
    });
    assert.equal(p.location, "Pune, Maharashtra");
    assert.equal(p.linkedIn, "https://www.linkedin.com/in/ravi-k");
    assert.equal(p.experienceYears, 4.6);
    assert.deepEqual(p.skills, ["Java", "AWS"]);
    assert.deepEqual(p.certifications, ["Azure Fundamentals AZ-900"]);
    assert.deepEqual(p.education, [{ degree: "MBA", institution: "", year: "" }]);
  });

  it("bounds the resume text sent to the model", () => {
    assert.ok(aiProfileUserPrompt("x".repeat(50_000)).length < 12_100);
  });
});

describe("OCR text cache", () => {
  it("is scoped to the organization and file content, and expires", () => {
    const buf = Buffer.from("%PDF scanned");
    rememberOcrText("org-a", buf, "ocr text", 1_000);
    assert.equal(recallOcrText("org-a", buf, 2_000), "ocr text");
    assert.equal(recallOcrText("org-b", buf, 2_000), null, "another organization cannot read it");
    assert.equal(recallOcrText("org-a", Buffer.from("%PDF other"), 2_000), null);
    assert.equal(recallOcrText("org-a", buf, 1_000 + 31 * 60_000), null, "expired after 30 minutes");
  });
});

describe("profile queue file", () => {
  it("enqueues, reports status only to the same organization, and recovers interrupted jobs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hireos-queue-"));
    const file = path.join(dir, "queue", "q.json");
    try {
      await enqueueProfileJobs(file, [{ candidateId: "c1", organizationId: "o1", experienceSet: false }], 1);
      assert.deepEqual(await profileJobStatus(file, "c1", "o1"), { status: "pending", error: undefined });
      assert.equal(await profileJobStatus(file, "c1", "o2"), null);
      assert.equal(await profileJobStatus(file, "missing", "o1"), null);
      assert.equal(await recoverProfileJobs(file, 2), 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("candidate page helpers", () => {
  it("links only real LinkedIn profile URLs", () => {
    assert.equal(safeLinkedInHref("https://www.linkedin.com/in/ravi-k"), "https://www.linkedin.com/in/ravi-k");
    assert.equal(safeLinkedInHref("javascript:alert(1)"), null);
    assert.equal(safeLinkedInHref("https://evil.com/linkedin.com/in/x"), null);
    assert.equal(safeLinkedInHref(null), null);
  });

  it("formats certifications from strings or objects", () => {
    assert.deepEqual(formatCertifications(["AWS CCP", { name: "AZ-900" }, 5, ""]), ["AWS CCP", "AZ-900"]);
    assert.deepEqual(formatCertifications("x"), []);
  });
});
