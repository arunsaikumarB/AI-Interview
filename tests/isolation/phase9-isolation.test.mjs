/**
 * Phase 9 isolation — committed CI guarantees (not a one-off manual pass).
 *
 * Covers:
 * 1) CANDIDATE JWT → 403 on every listed staff API (well-formed requests)
 * 2) Portal JSON contains zero score / evaluation fields
 * 3) Candidate A cannot read Candidate B application / resume / scores
 *
 * Requires: Postgres seeded, Next.js on BASE_URL (default :3000), AUTH_SECRET set.
 *   npm run test:isolation
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  assertNoScoreLeak,
  cleanupIsolationPair,
  mintCookie,
  prisma,
  seedIsolationPair,
} from "./helpers.mjs";

const STAFF_ENDPOINTS = [
  { method: "POST", path: "/api/talent/search", body: { query: "engineer", limit: 5 } },
  { method: "GET", path: "/api/candidates" },
  { method: "GET", path: "/api/interviews/nonexistent-but-well-formed-id" },
  { method: "GET", path: "/api/interviews/nonexistent-but-well-formed-id/secondary-recording/file" },
  { method: "GET", path: "/api/applications" },
  { method: "GET", path: "/api/applications/board" },
  { method: "GET", path: "/api/jobs" },
  { method: "GET", path: "/api/admin/users" },
  { method: "GET", path: "/api/admin/org" },
  { method: "GET", path: "/api/admin/departments" },
  { method: "GET", path: "/api/analytics" },
];

describe("Phase 9 candidate isolation", () => {
  /** @type {import('@prisma/client').PrismaClient} */
  let db;
  let pair;
  let cookieA;
  let cookieB;

  before(async () => {
    const health = await fetch(`${process.env.BASE_URL ?? "http://localhost:3000"}/api/health`);
    assert.equal(health.ok, true, "App must be reachable (npm run dev / start)");

    db = prisma();
    pair = await seedIsolationPair(db);
    cookieA = await mintCookie({
      id: pair.userA.id,
      email: pair.userA.email,
      name: pair.userA.name,
      role: "CANDIDATE",
      organizationId: pair.userA.organizationId,
    });
    cookieB = await mintCookie({
      id: pair.userB.id,
      email: pair.userB.email,
      name: pair.userB.name,
      role: "CANDIDATE",
      organizationId: pair.userB.organizationId,
    });
  });

  after(async () => {
    await cleanupIsolationPair(db, pair);
    await db?.$disconnect();
  });

  for (const ep of STAFF_ENDPOINTS) {
    it(`CANDIDATE → 403 ${ep.method} ${ep.path}`, async () => {
      const { res } = await api(cookieA, ep.method, ep.path, ep.body);
      assert.equal(
        res.status,
        403,
        `${ep.method} ${ep.path} must be 403 for CANDIDATE, got ${res.status}`,
      );
    });
  }

  it("portal/applications: only own apps + no score fields", async () => {
    const { res, json, text } = await api(cookieA, "GET", "/api/portal/applications");
    assert.equal(res.status, 200);
    assertNoScoreLeak("portal/applications", text);

    const apps = json.applications ?? [];
    assert.equal(apps.length, 1, "Alice must see exactly her own application");
    assert.equal(apps[0].id, pair.appA.id);
    assert.ok(
      !apps.some((a) => a.id === pair.appB.id),
      "Alice must not see Bob's application id",
    );
    assert.ok(
      !text.includes("SECRET_EVAL_REASONING_BOB_ONLY"),
      "Alice must not see Bob's evaluation reasoning",
    );
    assert.ok(
      !text.includes(pair.candB.id),
      "Alice portal payload must not mention Bob candidate id",
    );
    assert.ok(
      !text.includes("Bob SECRET"),
      "Alice must not see Bob resume text",
    );
  });

  it("portal/profile: own profile only + no score fields", async () => {
    const { res, json, text } = await api(cookieA, "GET", "/api/portal/profile");
    assert.equal(res.status, 200);
    assertNoScoreLeak("portal/profile", text);
    assert.equal(json.profile?.id, pair.candA.id);
    assert.ok(!text.includes(pair.candB.email));
    assert.ok(!text.includes("Bob SECRET"));
    assert.ok(!text.includes("SECRET_EVAL_REASONING_BOB_ONLY"));
  });

  it("IDOR: well-formed GET /api/candidates/{Bob} → 403 (not 404 masking)", async () => {
    const { res, text } = await api(cookieA, "GET", `/api/candidates/${pair.candB.id}`);
    assert.equal(res.status, 403);
    assert.ok(!text.includes("Bob SECRET"));
    assert.ok(!text.includes("SECRET_EVAL_REASONING_BOB_ONLY"));
    assert.ok(!text.includes(String(91)));
  });

  it("IDOR: well-formed GET /api/applications/{BobApp} → 403", async () => {
    const { res, text } = await api(
      cookieA,
      "GET",
      `/api/applications/${pair.appB.id}`,
    );
    assert.equal(res.status, 403);
    assert.ok(!text.includes("SECRET_EVAL_REASONING_BOB_ONLY"));
    assert.ok(!text.includes("Bob SECRET"));
    assert.ok(!/"aiEvaluations"\s*:/.test(text));
  });

  it("IDOR: portal query params cannot select Bob", async () => {
    const path =
      `/api/portal/applications?candidateId=${pair.candB.id}` +
      `&applicationId=${pair.appB.id}`;
    const { res, json, text } = await api(cookieA, "GET", path);
    assert.equal(res.status, 200);
    assertNoScoreLeak("portal/applications?foreignIds", text);
    const ids = (json.applications ?? []).map((a) => a.id);
    assert.deepEqual(ids, [pair.appA.id]);
    assert.ok(!text.includes("SECRET_EVAL_REASONING_BOB_ONLY"));
  });

  it("Bob portal sees only Bob (symmetry)", async () => {
    const { res, json, text } = await api(cookieB, "GET", "/api/portal/applications");
    assert.equal(res.status, 200);
    assertNoScoreLeak("portal/applications as Bob", text);
    assert.equal(json.applications?.[0]?.id, pair.appB.id);
    // Candidate-safe label for SCREENING — never raw AI score
    assert.equal(json.applications?.[0]?.stageLabel, "Under review");
    assert.ok(!text.includes("SECRET_EVAL_REASONING_BOB_ONLY"));
    assert.ok(!/"overall"\s*:\s*91/.test(text));
  });
});

describe("Phase 4C secondary recording access", () => {
  let db;
  let pair;
  let interview;
  let recruiterSame;
  let recruiterOther;
  let otherOrg;
  let cookieRecruiter;
  let cookieOther;
  let cookieCandidate;

  before(async () => {
    db = prisma();
    pair = await seedIsolationPair(db);
    const stamp = Date.now();
    const passwordHash = pair.userA.passwordHash;

    recruiterSame = await db.user.create({
      data: {
        email: `iso-rec-${stamp}@example.com`,
        name: "Iso Recruiter",
        role: "RECRUITER",
        passwordHash,
        organizationId: pair.org.id,
        isActive: true,
      },
    });
    otherOrg = await db.organization.create({
      data: {
        name: `Iso Other ${stamp}`,
        slug: `iso-other-${stamp}`,
        companyName: `Iso Other ${stamp}`,
      },
    });
    recruiterOther = await db.user.create({
      data: {
        email: `iso-rec-other-${stamp}@example.com`,
        name: "Other Recruiter",
        role: "RECRUITER",
        passwordHash,
        organizationId: otherOrg.id,
        isActive: true,
      },
    });
    interview = await db.interviewSession.create({
      data: {
        applicationId: pair.appB.id,
        accessToken: `iso-rec-token-${stamp}`,
        status: "COMPLETED",
        secondaryRecordingStatus: "SAVED",
        secondaryRecordingPath: "interviews/iso-missing/recording.webm",
      },
    });
    cookieRecruiter = await mintCookie({
      id: recruiterSame.id,
      email: recruiterSame.email,
      name: recruiterSame.name,
      role: "RECRUITER",
      organizationId: recruiterSame.organizationId,
    });
    cookieOther = await mintCookie({
      id: recruiterOther.id,
      email: recruiterOther.email,
      name: recruiterOther.name,
      role: "RECRUITER",
      organizationId: recruiterOther.organizationId,
    });
    cookieCandidate = await mintCookie({
      id: pair.userA.id,
      email: pair.userA.email,
      name: pair.userA.name,
      role: "CANDIDATE",
      organizationId: pair.userA.organizationId,
    });
  });

  after(async () => {
    if (interview) {
      await db.interviewSession.deleteMany({ where: { id: interview.id } });
    }
    if (recruiterSame || recruiterOther) {
      await db.user.deleteMany({
        where: {
          id: {
            in: [recruiterSame?.id, recruiterOther?.id].filter(Boolean),
          },
        },
      });
    }
    if (otherOrg) {
      await db.organization.deleteMany({ where: { id: otherOrg.id } });
    }
    await cleanupIsolationPair(db, pair);
    await db?.$disconnect();
  });

  const filePath = () =>
    `/api/interviews/${interview.id}/secondary-recording/file`;

  it("unauthenticated → 401 GET secondary-recording/file", async () => {
    const res = await fetch(
      `${process.env.BASE_URL ?? "http://localhost:3000"}${filePath()}`,
    );
    assert.equal(res.status, 401);
  });

  it("candidate → 403 GET secondary-recording/file", async () => {
    const { res } = await api(cookieCandidate, "GET", filePath());
    assert.equal(res.status, 403);
  });

  it("recruiter same organization → allowed (not 403)", async () => {
    const { res } = await api(cookieRecruiter, "GET", filePath());
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 401);
    assert.ok(
      res.status === 200 || res.status === 404,
      `same-org recruiter must be authorized, got ${res.status}`,
    );
  });

  it("recruiter other organization → 403", async () => {
    const { res } = await api(cookieOther, "GET", filePath());
    assert.equal(res.status, 403);
  });

  it("invalid session → denied", async () => {
    const { res } = await api(
      cookieRecruiter,
      "GET",
      "/api/interviews/clxxxxxxxxxxxxxxxxxxxx/secondary-recording/file",
    );
    assert.ok(res.status === 404 || res.status === 403);
  });
});
