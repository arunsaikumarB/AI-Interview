/**
 * Step 5 integrity API verification (server authority).
 * Run: node --import ./tests/isolation/load-env.mjs scripts/verify-integrity.mjs
 */
import { PrismaClient } from "@prisma/client";
import { BASE } from "../tests/isolation/helpers.mjs";

const prisma = new PrismaClient();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function main() {
  const app = await prisma.application.findFirst({
    where: { status: "ACTIVE" },
    include: { job: true, candidate: true },
  });
  assert(app, "Need an active application for integrity test");

  const token = `integrity-test-${Date.now()}`;
  const session = await prisma.interviewSession.create({
    data: {
      applicationId: app.id,
      mode: "AI_ADAPTIVE",
      deliveryMode: "TEXT",
      status: "IN_PROGRESS",
      interviewType: "TECHNICAL",
      accessToken: token,
      maxQuestions: 5,
      durationMinutes: 30,
      startedAt: new Date(),
      proctoringEnabled: true,
      proctoringMode: "STANDARD",
      proctoringConsentAt: new Date(),
      integrityMode: "STRICT",
      integrityConsentAt: new Date(),
      plan: {
        topics: [{ name: "Basics", weight: 1 }],
        openingQuestion: {
          question: "Tell me about yourself",
          topic: "Basics",
          difficulty: "EASY",
          competency: "communication",
        },
        focusAreas: [],
      },
    },
  });

  console.log("created session", session.id);

  // A/B Standard would not terminate — we test STRICT path here.
  const v1 = await postJson(`${BASE}/api/interview/${token}/integrity/violation`, {
    kind: "FOCUS_LOSS",
    timestamp: new Date().toISOString(),
    episodeId: "ep-test-1",
  });
  assert(v1.res.ok, `first violation failed: ${JSON.stringify(v1.json)}`);
  assert(v1.json.showWarning === true, "expected warning on first violation");
  assert(v1.json.terminated === false, "must not terminate on first");
  console.log("PASS first violation → warning");

  // Same episode id → idempotent no double count
  const dup = await postJson(`${BASE}/api/interview/${token}/integrity/violation`, {
    kind: "FOCUS_LOSS",
    timestamp: new Date().toISOString(),
    episodeId: "ep-test-1",
  });
  assert(dup.res.ok, "dup request failed");
  assert(dup.json.recorded === false, "duplicate episode should not record");
  console.log("PASS episode debounce / idempotency");

  const v2 = await postJson(`${BASE}/api/interview/${token}/integrity/violation`, {
    kind: "FOCUS_LOSS",
    timestamp: new Date().toISOString(),
    episodeId: "ep-test-2",
  });
  assert(v2.res.ok, `second violation failed: ${JSON.stringify(v2.json)}`);
  assert(v2.json.terminated === true, "second violation must terminate");
  assert(v2.json.status === "TERMINATED", "status TERMINATED");
  console.log("PASS second violation → terminate");

  const after = await prisma.interviewSession.findUnique({
    where: { id: session.id },
  });
  assert(after.status === "TERMINATED", "DB status TERMINATED");
  assert(after.integrityTerminatedReason, "termination reason set");

  // Refresh / API bypass
  const again = await postJson(`${BASE}/api/interview/${token}/integrity/violation`, {
    kind: "FOCUS_LOSS",
    timestamp: new Date().toISOString(),
    episodeId: "ep-test-3",
  });
  assert(again.json.terminated === true, "remains terminated");
  console.log("PASS remains terminated");

  const start = await postJson(`${BASE}/api/interview/${token}/start`, {});
  assert(start.res.status === 410, "start after terminate must fail");
  console.log("PASS cannot restart after terminate");

  const answer = await postJson(`${BASE}/api/interview/${token}/answer`, {
    answerText: "bypass attempt",
  });
  assert(answer.res.status === 410, "answer after terminate must fail");
  console.log("PASS cannot answer after terminate");

  // ATS isolation: application stage unchanged
  const appAfter = await prisma.application.findUnique({
    where: { id: app.id },
  });
  assert(appAfter.stage === app.stage, "ATS stage must not change");
  console.log("PASS ATS stage unchanged");

  // STANDARD mode: no terminate
  const token2 = `integrity-std-${Date.now()}`;
  await prisma.interviewSession.create({
    data: {
      applicationId: app.id,
      mode: "AI_ADAPTIVE",
      deliveryMode: "TEXT",
      status: "IN_PROGRESS",
      interviewType: "TECHNICAL",
      accessToken: token2,
      maxQuestions: 5,
      startedAt: new Date(),
      proctoringEnabled: true,
      proctoringMode: "STANDARD",
      proctoringConsentAt: new Date(),
      integrityMode: "STANDARD",
      integrityConsentAt: new Date(),
      plan: {
        topics: [{ name: "Basics", weight: 1 }],
        openingQuestion: {
          question: "Q",
          topic: "Basics",
          difficulty: "EASY",
          competency: "x",
        },
        focusAreas: [],
      },
    },
  });
  const s1 = await postJson(`${BASE}/api/interview/${token2}/integrity/violation`, {
    kind: "FOCUS_LOSS",
    timestamp: new Date().toISOString(),
    episodeId: "std-1",
  });
  const s2 = await postJson(`${BASE}/api/interview/${token2}/integrity/violation`, {
    kind: "FOCUS_LOSS",
    timestamp: new Date().toISOString(),
    episodeId: "std-2",
  });
  assert(s1.json.terminated !== true && s2.json.terminated !== true, "STANDARD must not terminate");
  console.log("PASS STANDARD mode: signals only (no terminate)");

  // Paste: first warn, second terminate on fresh STRICT session
  const token3 = `integrity-paste-${Date.now()}`;
  await prisma.interviewSession.create({
    data: {
      applicationId: app.id,
      mode: "AI_ADAPTIVE",
      deliveryMode: "TEXT",
      status: "IN_PROGRESS",
      interviewType: "TECHNICAL",
      accessToken: token3,
      maxQuestions: 5,
      startedAt: new Date(),
      proctoringEnabled: true,
      proctoringMode: "STANDARD",
      proctoringConsentAt: new Date(),
      integrityMode: "STRICT",
      integrityConsentAt: new Date(),
      plan: {
        topics: [{ name: "Basics", weight: 1 }],
        openingQuestion: {
          question: "Q",
          topic: "Basics",
          difficulty: "EASY",
          competency: "x",
        },
        focusAreas: [],
      },
    },
  });
  const p1 = await postJson(`${BASE}/api/interview/${token3}/integrity/violation`, {
    kind: "PASTE",
    timestamp: new Date().toISOString(),
    episodeId: "paste-1",
    pastedLength: 42,
  });
  assert(p1.json.showWarning === true && !p1.json.terminated, "paste 1 = warn");
  const p2 = await postJson(`${BASE}/api/interview/${token3}/integrity/violation`, {
    kind: "PASTE",
    timestamp: new Date().toISOString(),
    episodeId: "paste-2",
    pastedLength: 10,
  });
  assert(p2.json.terminated === true, "paste 2 = terminate");
  const pe = await prisma.proctoringEvent.findFirst({
    where: { session: { accessToken: token3 }, type: "COPY_PASTE" },
    orderBy: { timestamp: "asc" },
  });
  const meta = pe?.meta ?? {};
  assert(!("content" in meta) && !("text" in meta), "paste content must not be stored");
  assert(meta.pastedLength === 42 || meta.pastedLength === 10, "length stored");
  console.log("PASS paste policy + no content stored");

  console.log("\nAll integrity API checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
