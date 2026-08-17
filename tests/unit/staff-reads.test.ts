import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUseDjangoReads } from "../../src/lib/staff-reads/flag";
import {
  normalizeApplicationListItem,
  normalizeCandidateListItem,
  normalizeJob,
  type DjangoApplication,
  type DjangoCandidate,
  type DjangoJob,
} from "../../src/lib/staff-reads/normalize";

describe("parseUseDjangoReads", () => {
  it("defaults off", () => {
    assert.equal(parseUseDjangoReads(undefined), false);
    assert.equal(parseUseDjangoReads(""), false);
    assert.equal(parseUseDjangoReads("false"), false);
  });

  it("enables only explicit truthy values", () => {
    assert.equal(parseUseDjangoReads("true"), true);
    assert.equal(parseUseDjangoReads("1"), true);
    assert.equal(parseUseDjangoReads("YES"), true);
  });
});

describe("normalizeJob", () => {
  it("maps applicationCount to _count.applications", () => {
    const job = normalizeJob({
      id: "j1",
      organizationId: "o1",
      departmentId: "d1",
      title: "Engineer",
      description: "desc",
      location: "Remote",
      experienceMin: 0,
      experienceMax: 5,
      skills: ["ts"],
      salaryMin: null,
      salaryMax: null,
      employmentType: "FULL_TIME",
      openings: 1,
      status: "OPEN",
      interviewStages: [],
      screeningCriteria: {},
      createdById: "u1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      applicationCount: 4,
      organization: { id: "o1", name: "Org", slug: "org" },
      department: { id: "d1", name: "Eng" },
      createdBy: { id: "u1", name: "Pat", email: "p@example.com" },
    } satisfies DjangoJob);
    assert.equal(job._count.applications, 4);
    assert.equal(job.title, "Engineer");
    assert.deepEqual(job.skills, ["ts"]);
  });
});

describe("normalizeCandidateListItem", () => {
  it("does not invent nested applications", () => {
    const c = normalizeCandidateListItem({
      id: "c1",
      organizationId: "o1",
      userId: null,
      email: "a@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      phone: null,
      linkedIn: null,
      location: null,
      summary: null,
      skills: ["python"],
      experience: 2,
      education: [],
      certifications: [],
      resumeUrl: null,
      resumeText: "text",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      applicationCount: 1,
    } satisfies DjangoCandidate);
    assert.equal(c._count.applications, 1);
    assert.equal("applications" in c, false);
  });
});

describe("normalizeApplicationListItem", () => {
  it("strips extra nested fields and does not invent aiEvaluations", () => {
    const app = normalizeApplicationListItem({
      id: "a1",
      candidateId: "c1",
      jobId: "j1",
      stage: "APPLIED",
      status: "ACTIVE",
      source: "career_site",
      coverNote: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      candidate: {
        id: "c1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "a@example.com",
        experience: 9,
        skills: ["secret-skill"],
      },
      job: {
        id: "j1",
        title: "Engineer",
        status: "OPEN",
        department: { name: "Eng" },
      },
    } satisfies DjangoApplication);
    assert.equal(app.candidate.email, "a@example.com");
    assert.equal("experience" in app.candidate, false);
    assert.equal("aiEvaluations" in app, false);
  });
});
