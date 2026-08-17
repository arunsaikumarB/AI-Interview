/**
 * F-05 audit evidence — durability across the exact lifecycle that destroyed it.
 *
 * Run D could not prove `baselineCapturedAt >= placementConfirmedAt` because
 * `InterviewSession.secondaryPlacementConfirmedAt` is nulled on disconnect
 * (heartbeat/route.ts). These tests pin that the append-only TimelineEvent
 * records survive disconnect, reconnect, placement reset and completion, and
 * that adding them changes nothing else.
 *
 * Sessions are created directly through Prisma so the suite never invokes
 * Ollama plan generation.
 *
 * Requires: Postgres seeded, Next.js on BASE_URL (default :3000).
 *   npm run test:isolation
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { BASE, prisma } from "./helpers.mjs";

const PLACEMENT_KIND = "secondary_placement_confirmed";
const BASELINE_KIND = "secondary_baseline_captured";

/** 1x1 JPEG — the live-frame gate only needs a decodable image. */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The heartbeat endpoint is rate-limited per second (MAX_HEARTBEATS_PER_SEC),
 * which is real product behaviour, not something under test here. Space calls
 * so the suite exercises the audit path rather than the limiter.
 */
let lastHbAt = 0;
async function hb(code, body) {
  const gap = Date.now() - lastHbAt;
  if (gap < 1100) await sleep(1100 - gap);
  lastHbAt = Date.now();
  return fetch(`${BASE}/api/interview/secondary/${code}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

describe("F-05 audit evidence durability", () => {
  /** @type {import('@prisma/client').PrismaClient} */
  let db;
  let application;
  let sessionId;
  let code;

  const auditRows = async (kind) =>
    (
      await db.timelineEvent.findMany({
        where: { applicationId: application.id, type: "OTHER" },
        orderBy: { createdAt: "asc" },
      })
    ).filter((e) => e.payload?.kind === kind && e.payload?.sessionId === sessionId);

  before(async () => {
    const health = await fetch(`${BASE}/api/health`);
    assert.equal(health.ok, true, "App must be reachable");

    db = prisma();
    application = await db.application.findFirst({ orderBy: { createdAt: "asc" } });
    assert.ok(application, "No application — run db:seed first");

    code = crypto.randomBytes(24).toString("hex");
    const s = await db.interviewSession.create({
      data: {
        applicationId: application.id,
        accessToken: crypto.randomBytes(32).toString("hex"),
        status: "IN_PROGRESS",
        deliveryMode: "TEXT",
        proctoringEnabled: true,
        proctoringMode: "ENHANCED",
        integrityMode: "STANDARD",
        startedAt: new Date(),
        secondaryRecordingConsentAt: new Date(),
        secondaryPairToken: code,
        secondaryPairExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        secondaryDeviceStatus: "CONNECTED",
        secondaryPlacementConfirmedAt: new Date(),
      },
    });
    sessionId = s.id;
  });

  after(async () => {
    if (!db) return;
    if (sessionId) {
      await db.timelineEvent.deleteMany({
        where: { applicationId: application.id, type: "OTHER" },
      }).catch(() => {});
      await db.interviewSession.deleteMany({ where: { id: sessionId } });
    }
    await db.$disconnect();
  });

  it("BACKWARD COMPAT: a heartbeat with no baseline fields still succeeds and records nothing", async () => {
    const before = (await auditRows(BASELINE_KIND)).length;
    const res = await hb(code, {});
    assert.equal(res.ok, true, "plain heartbeat must keep working");
    assert.equal((await auditRows(BASELINE_KIND)).length, before);
  });

  it("rejects a malformed baseline timestamp without creating a record", async () => {
    for (const bad of ["not-a-date", "", 12345]) {
      const res = await hb(code, { baselineCapturedAt: bad, baselineSettled: true });
      assert.equal(res.ok, true, "malformed evidence must not break the heartbeat");
    }
    assert.equal((await auditRows(BASELINE_KIND)).length, 0);
  });

  it("records a baseline capture reported on an ordinary heartbeat", async () => {
    const capturedAt = new Date().toISOString();
    const res = await hb(code, { baselineCapturedAt: capturedAt, baselineSettled: true });
    assert.equal(res.ok, true);

    const rows = await auditRows(BASELINE_KIND);
    assert.equal(rows.length, 1, "exactly one baseline record");
    const p = rows[0].payload;
    assert.equal(p.capturedAt, capturedAt);
    assert.equal(p.settled, true);
    assert.ok(p.placementConfirmedAt, "must be paired with a placement");
    assert.equal(p.invariantHeld, true, "baseline must follow placement");
    assert.equal(p.noAtsStageChange, true);
    assert.equal(p.noAiInput, true);
  });

  it("IDEMPOTENT: heartbeat retries of the same capture create no duplicate", async () => {
    const rows = await auditRows(BASELINE_KIND);
    const capturedAt = rows[0].payload.capturedAt;
    for (let i = 0; i < 4; i++) {
      await hb(code, { baselineCapturedAt: capturedAt, baselineSettled: true });
    }
    assert.equal((await auditRows(BASELINE_KIND)).length, 1, "retries must not duplicate");
  });

  it("REGRESSION: disconnect clears the DB column but the audit rows remain", async () => {
    const baselinesBefore = (await auditRows(BASELINE_KIND)).length;
    assert.ok(baselinesBefore >= 1);

    const res = await hb(code, { disconnect: true });
    assert.equal(res.ok, true);

    const s = await db.interviewSession.findUnique({
      where: { id: sessionId },
      select: { secondaryPlacementConfirmedAt: true, secondaryDeviceStatus: true },
    });
    assert.equal(
      s.secondaryPlacementConfirmedAt,
      null,
      "transient column is still cleared — behaviour unchanged",
    );

    assert.equal(
      (await auditRows(BASELINE_KIND)).length,
      baselinesBefore,
      "THE FIX: audit evidence survives the disconnect that destroyed Run D",
    );
  });

  it("reconnect produces a new placement/baseline pair, each correctly associated", async () => {
    // Reconnect: placement is re-confirmed, phone captures a fresh baseline.
    const secondPlacement = new Date();
    await db.interviewSession.update({
      where: { id: sessionId },
      data: {
        secondaryDeviceStatus: "CONNECTED",
        secondaryPlacementConfirmedAt: secondPlacement,
      },
    });

    const secondBaseline = new Date(secondPlacement.getTime() + 7000).toISOString();
    await hb(code, { baselineCapturedAt: secondBaseline, baselineSettled: true });

    const rows = await auditRows(BASELINE_KIND);
    assert.equal(rows.length, 2, "a reconnect legitimately yields a second baseline");

    const latest = rows[rows.length - 1].payload;
    assert.equal(latest.capturedAt, secondBaseline);
    assert.equal(
      latest.placementConfirmedAt,
      secondPlacement.toISOString(),
      "paired with the most recent preceding placement, not the first",
    );
    assert.equal(latest.invariantHeld, true);

    // The two records must not be confused with one another.
    assert.notEqual(rows[0].payload.capturedAt, rows[1].payload.capturedAt);
    assert.notEqual(
      rows[0].payload.placementConfirmedAt,
      rows[1].payload.placementConfirmedAt,
    );
  });

  it("evidence survives session completion", async () => {
    const before = (await auditRows(BASELINE_KIND)).length;
    await db.interviewSession.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", endedAt: new Date() },
    });
    assert.equal((await auditRows(BASELINE_KIND)).length, before);
  });

  it("ProctoringEvent counts are unchanged — audit rows never pollute signals", async () => {
    const n = await db.proctoringEvent.count({ where: { sessionId } });
    assert.equal(n, 0, "audit evidence must not be written as a proctoring signal");
  });

  it("Application.stage is unchanged", async () => {
    const fresh = await db.application.findUnique({
      where: { id: application.id },
      select: { stage: true, status: true, updatedAt: true },
    });
    assert.equal(fresh.stage, application.stage);
    assert.equal(fresh.status, application.status);
    assert.equal(
      fresh.updatedAt.getTime(),
      application.updatedAt.getTime(),
      "writing audit evidence must not touch the application",
    );
  });
});

describe("F-05 audit evidence — placement recorded through the real route", () => {
  /** @type {import('@prisma/client').PrismaClient} */
  let db;
  let application;
  let sessionId;
  let token;
  let code;

  before(async () => {
    db = prisma();
    application = await db.application.findFirst({ orderBy: { createdAt: "asc" } });
    token = crypto.randomBytes(32).toString("hex");
    code = crypto.randomBytes(24).toString("hex");
    const s = await db.interviewSession.create({
      data: {
        applicationId: application.id,
        accessToken: token,
        status: "IN_PROGRESS",
        deliveryMode: "TEXT",
        proctoringEnabled: true,
        proctoringMode: "ENHANCED",
        integrityMode: "STANDARD",
        startedAt: new Date(),
        proctoringConsentAt: new Date(),
        secondaryRecordingConsentAt: new Date(),
        secondaryPairToken: code,
        secondaryPairExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        secondaryDeviceStatus: "WAITING",
      },
    });
    sessionId = s.id;
  });

  after(async () => {
    if (!db) return;
    if (sessionId) {
      await db.timelineEvent.deleteMany({
        where: { applicationId: application.id, type: "OTHER" },
      }).catch(() => {});
      await db.proctoringEvent.deleteMany({ where: { sessionId } }).catch(() => {});
      await db.interviewSession.deleteMany({ where: { id: sessionId } });
    }
    await db.$disconnect();
  });

  const placementRows = async () =>
    (
      await db.timelineEvent.findMany({
        where: { applicationId: application.id, type: "OTHER" },
      })
    ).filter(
      (e) => e.payload?.kind === PLACEMENT_KIND && e.payload?.sessionId === sessionId,
    );

  async function pairAndConfirm() {
    await fetch(`${BASE}/api/interview/secondary/${code}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await hb(code, {});
    const form = new FormData();
    form.append("frame", new Blob([TINY_JPEG], { type: "image/jpeg" }), "f.jpg");
    await fetch(`${BASE}/api/interview/secondary/${code}/frame`, {
      method: "POST",
      body: form,
    });
    return fetch(`${BASE}/api/interview/${token}/proctoring/secondary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm_placement" }),
    });
  }

  it("confirm_placement writes exactly one durable placement record", async () => {
    // confirm_placement requires a live preview frame < 3s old. On a cold dev
    // server the /frame route can spend longer than that compiling, so the
    // first attempt legitimately gets "Secondary camera is not connected".
    // That is the product's safety gate working; retry rather than assert on a
    // compile race.
    let res = await pairAndConfirm();
    for (let i = 0; i < 3 && res.status !== 200; i++) {
      await sleep(1200);
      res = await pairAndConfirm();
    }
    assert.equal(res.status, 200, await res.text());

    const rows = await placementRows();
    assert.equal(rows.length, 1);
    const p = rows[0].payload;
    assert.ok(p.confirmedAt, "records when placement happened");
    assert.equal(p.noAtsStageChange, true);
    assert.equal(p.noAiInput, true);
  });

  it("DUPLICATE PREVENTION: re-confirming without a reset adds no second record", async () => {
    await pairAndConfirm();
    await pairAndConfirm();
    assert.equal((await placementRows()).length, 1);
  });

  it("after a placement reset, a new confirmation is recorded separately", async () => {
    await fetch(`${BASE}/api/interview/${token}/proctoring/secondary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_placement" }),
    });
    const s = await db.interviewSession.findUnique({
      where: { id: sessionId },
      select: { secondaryPlacementConfirmedAt: true },
    });
    assert.equal(s.secondaryPlacementConfirmedAt, null, "reset clears the column");
    assert.equal(
      (await placementRows()).length,
      1,
      "but the earlier evidence survives the reset",
    );

    const res = await pairAndConfirm();
    assert.equal(res.status, 200, await res.text());
    assert.equal((await placementRows()).length, 2, "a genuine re-placement is recorded");
  });
});
