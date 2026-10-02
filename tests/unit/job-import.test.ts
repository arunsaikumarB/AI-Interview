import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// The module imports @prisma/client, which copies the repo .env into process.env
// for unset keys. Pin DATABASE_URL so this test can never reach a real database.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit_test_unreachable";

import type { PrismaClient } from "@prisma/client";
import {
  buildDescription,
  buildLocation,
  JOB_IMPORT_MAX,
  JobImportError,
  parseEmploymentType,
  parseExperience,
  parseListingsJson,
  planJobImport,
} from "../../src/lib/job-import";

function fakePrisma(existingTitles: string[], departments: Array<{ id: string; name: string }>) {
  return {
    job: { findMany: async () => existingTitles.map((title) => ({ title })) },
    department: { findMany: async () => departments },
  } as unknown as PrismaClient;
}

const listing = (over: Record<string, unknown> = {}) => ({
  id: "slug",
  jobId: "LST/HY/X/1/24",
  title: "QA Automation Engineer",
  location: "Hyderabad",
  workType: "Onsite",
  experience: "2+ yrs",
  duration: "Full time",
  department: "Quality Assurance",
  closingDate: "AUG 15, 2024",
  positions: 2,
  summary: "Design and maintain automation frameworks.",
  responsibilities: ["Build suites."],
  requirements: ["2+ years in QA."],
  whyJoinUs: ["Growth."],
  ...over,
});

describe("parseExperience", () => {
  it("understands the careers-site formats", () => {
    assert.deepEqual(parseExperience("2+ yrs"), { min: 2, max: null });
    assert.deepEqual(parseExperience("0-1 Years"), { min: 0, max: 1 });
    assert.deepEqual(parseExperience("0–2 Years"), { min: 0, max: 2 });
    assert.deepEqual(parseExperience("3 to 5 years"), { min: 3, max: 5 });
    assert.deepEqual(parseExperience(""), { min: 0, max: null });
    assert.deepEqual(parseExperience(undefined), { min: 0, max: null });
  });
  it("rejects what it cannot read instead of guessing", () => {
    assert.equal(parseExperience("Senior"), null);
    assert.equal(parseExperience("5-2 years"), null);
  });
});

describe("parseEmploymentType", () => {
  it("maps durations and rejects unknown ones", () => {
    assert.equal(parseEmploymentType("Full time"), "FULL_TIME");
    assert.equal(parseEmploymentType("Part-time"), "PART_TIME");
    assert.equal(parseEmploymentType("Internship"), "INTERN");
    assert.equal(parseEmploymentType(undefined), "FULL_TIME");
    assert.equal(parseEmploymentType("Weekends"), null);
  });
});

describe("buildDescription / buildLocation", () => {
  it("keeps every section and the website reference as plain text", () => {
    const d = buildDescription(listing() as never);
    assert.match(d, /^Design and maintain automation frameworks\./);
    assert.match(d, /Responsibilities\n- Build suites\./);
    assert.match(d, /Requirements\n- 2\+ years in QA\./);
    assert.match(d, /Why join us\n- Growth\./);
    assert.match(d, /Careers website reference: LST\/HY\/X\/1\/24$/);
    assert.equal(buildLocation(listing() as never), "Hyderabad · Onsite");
    assert.equal(buildLocation(listing({ workType: undefined }) as never), "Hyderabad");
  });
});

describe("parseListingsJson", () => {
  it("accepts an array or { jobs: [...] } and rejects bad input", () => {
    assert.equal(parseListingsJson("[{}]").length, 1);
    assert.equal(parseListingsJson('{"jobs":[{},{}]}').length, 2);
    assert.throws(() => parseListingsJson("not json"), JobImportError);
    assert.throws(() => parseListingsJson("[]"), JobImportError);
    assert.throws(() => parseListingsJson('{"x":1}'), JobImportError);
    assert.throws(() => parseListingsJson(JSON.stringify(new Array(JOB_IMPORT_MAX + 1).fill({}))), JobImportError);
  });
});

describe("planJobImport", () => {
  it("plans DRAFT-ready jobs, maps departments, and never touches existing titles", async () => {
    const plan = await planJobImport({
      prisma: fakePrisma(["us it recruiter"], [{ id: "dept-qa", name: "quality assurance" }]),
      organizationId: "org",
      jsonText: JSON.stringify([
        listing(),
        listing({ title: "US IT Recruiter", department: "Talent Acquisition" }),
        listing({ title: "qa automation engineer" }),
        listing({ title: "Ops", experience: "Senior" }),
        listing({ title: "Sales", department: "Sales", experience: "0-1 Years", positions: undefined }),
        { title: "X" },
      ]),
    });

    assert.deepEqual(plan.ready.map((r) => r.draft.title), ["QA Automation Engineer", "Sales"]);
    const qa = plan.ready[0];
    assert.equal(qa.draft.departmentId, "dept-qa");
    assert.equal(qa.departmentFound, true);
    assert.equal(qa.draft.experienceMin, 2);
    assert.equal(qa.draft.experienceMax, null);
    assert.equal(qa.draft.openings, 2);
    assert.equal(qa.draft.employmentType, "FULL_TIME");
    const sales = plan.ready[1];
    assert.equal(sales.draft.departmentId, null);
    assert.equal(sales.departmentFound, false);
    assert.equal(sales.draft.openings, 1);

    const reasons = Object.fromEntries(plan.skipped.map((s) => [s.index, s.reasons.join("; ")]));
    assert.match(reasons[2], /already exists/);
    assert.match(reasons[3], /duplicate title/);
    assert.match(reasons[4], /experience "Senior" not understood/);
    assert.match(reasons[6], /title|summary/);
  });

  it("accepts the committed careers-website export as-is", async () => {
    const jsonText = readFileSync(path.join(__dirname, "../../docs/careers-website-jobs.json"), "utf8");
    const plan = await planJobImport({ prisma: fakePrisma([], []), organizationId: "org", jsonText });
    assert.equal(plan.skipped.length, 0, JSON.stringify(plan.skipped));
    assert.equal(plan.ready.length, 7);
  });
});
