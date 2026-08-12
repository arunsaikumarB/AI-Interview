/**
 * Step 4B reliability + security smoke (no physical phone).
 * node --import ./tests/isolation/load-env.mjs scripts/verify-enhanced-pair.mjs
 */
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { BASE } from "../tests/isolation/helpers.mjs";

const db = new PrismaClient();

function note(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const minimalPlan = {
  topics: ["A", "B", "C", "D", "E"].map((name) => ({
    name,
    why: `Cover ${name}`,
    targetDifficulty: 3,
    fromResume: false,
  })),
  openingQuestion: {
    question: "Tell me about a project you led.",
    topic: "A",
    difficulty: 3,
    competency: "ownership",
  },
  focusAreas: ["ownership"],
};

async function makeEnhancedSession(appId, interviewerId, extras = {}) {
  const accessToken = randomBytes(32).toString("hex");
  const session = await db.interviewSession.create({
    data: {
      applicationId: appId,
      mode: "AI_ADAPTIVE",
      deliveryMode: "TEXT",
      status: "SCHEDULED",
      interviewType: "TECHNICAL",
      accessToken,
      tokenExpiresAt: new Date(Date.now() + 3 * 864e5),
      durationMinutes: 30,
      maxQuestions: 3,
      plan: minimalPlan,
      adaptiveState: {
        currentTopicIndex: 0,
        questionsAsked: 0,
        followUpsOnCurrentTopic: 0,
        topicsCovered: [],
        difficulty: 3,
        concluded: false,
      },
      interviewerId,
      scheduledAt: new Date(),
      proctoringEnabled: true,
      proctoringMode: "ENHANCED",
      proctoringConsentAt: new Date(),
      proctoringCameraConsent: false,
      ...extras,
    },
  });
  return session;
}

async function tinyJpegForm() {
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
    "base64",
  );
  const form = new FormData();
  form.append("frame", new Blob([jpeg], { type: "image/jpeg" }), "frame.jpg");
  return form;
}

async function main() {
  const recruiter = await db.user.findUnique({
    where: { email: "recruiter@local.dev" },
  });
  const app = await db.application.findFirst({
    where: {
      status: { in: ["ACTIVE", "ON_HOLD"] },
      job: { organizationId: recruiter.organizationId ?? undefined },
    },
  });
  if (!app || !recruiter) throw new Error("seed data missing");

  const session = await makeEnhancedSession(app.id, recruiter.id);

  const mint = await fetch(
    `${BASE}/api/interview/${session.accessToken}/proctoring/secondary`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mint" }),
    },
  );
  const mintJ = await mint.json();
  note("Mint pair", mint.ok && Boolean(mintJ.pairToken), mintJ.status);
  const code = mintJ.pairToken;

  const connect = await fetch(`${BASE}/api/interview/secondary/${code}/connect`, {
    method: "POST",
  });
  note("Connect", connect.ok, String(connect.status));

  const form = await tinyJpegForm();
  const frameRes = await fetch(`${BASE}/api/interview/secondary/${code}/frame`, {
    method: "POST",
    body: form,
  });
  note("Frame upload", frameRes.ok, String(frameRes.status));

  const hostFrame = await fetch(
    `${BASE}/api/interview/${session.accessToken}/proctoring/secondary/frame`,
  );
  note("Host frame OK", hostFrame.ok, hostFrame.headers.get("content-type") ?? "");

  // Cross-session denial
  const other = await makeEnhancedSession(app.id, recruiter.id);
  const otherFrame = await fetch(
    `${BASE}/api/interview/${other.accessToken}/proctoring/secondary/frame`,
  );
  note(
    "Cross-session frame denied",
    otherFrame.status === 404 || otherFrame.status === 403 || otherFrame.status === 400,
    `status ${otherFrame.status}`,
  );

  // Random token denial
  const rand = await fetch(
    `${BASE}/api/interview/${randomBytes(32).toString("hex")}/proctoring/secondary/frame`,
  );
  note("Unknown accessToken frame denied", rand.status === 404, `status ${rand.status}`);

  // Expired pair token
  await db.interviewSession.update({
    where: { id: session.id },
    data: { secondaryPairExpiresAt: new Date(Date.now() - 1000) },
  });
  const expiredPair = await fetch(
    `${BASE}/api/interview/secondary/${code}/frame`,
    { method: "POST", body: await tinyJpegForm() },
  );
  note("Expired pairing token denied", expiredPair.status === 410, `status ${expiredPair.status}`);

  // Ended interview cleanup path
  await db.interviewSession.update({
    where: { id: session.id },
    data: {
      secondaryPairExpiresAt: new Date(Date.now() + 864e5),
      status: "COMPLETED",
      endedAt: new Date(),
    },
  });

  const endedFrame = await fetch(
    `${BASE}/api/interview/${session.accessToken}/proctoring/secondary/frame`,
  );
  note(
    "Ended session frame denied",
    endedFrame.status === 410 || endedFrame.status === 404,
    `status ${endedFrame.status}`,
  );

  const endedConnect = await fetch(
    `${BASE}/api/interview/secondary/${code}/connect`,
    { method: "POST" },
  );
  note(
    "Ended session connect denied",
    endedConnect.status === 410 || endedConnect.status === 400,
    `status ${endedConnect.status}`,
  );

  // Status labels
  const liveSession = await makeEnhancedSession(app.id, recruiter.id);
  const mint2 = await fetch(
    `${BASE}/api/interview/${liveSession.accessToken}/proctoring/secondary`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mint" }),
    },
  );
  const mint2J = await mint2.json();
  await fetch(`${BASE}/api/interview/secondary/${mint2J.pairToken}/connect`, {
    method: "POST",
  });
  await fetch(`${BASE}/api/interview/secondary/${mint2J.pairToken}/frame`, {
    method: "POST",
    body: await tinyJpegForm(),
  });
  const st = await fetch(
    `${BASE}/api/interview/${liveSession.accessToken}/proctoring/secondary`,
  );
  const stJ = await st.json();
  note(
    "Human label for connected",
    st.ok && stJ.label === "Secondary camera connected" && stJ.status === "CONNECTED",
    `${stJ.status} / ${stJ.label}`,
  );

  // Rate limit: flood frames
  let limited = false;
  for (let i = 0; i < 8; i++) {
    const r = await fetch(
      `${BASE}/api/interview/secondary/${mint2J.pairToken}/frame`,
      { method: "POST", body: await tinyJpegForm() },
    );
    if (r.status === 429) limited = true;
  }
  note("Frame rate limit engages", limited, limited ? "429 seen" : "no 429");

  // Cleanup
  await db.interviewSession.deleteMany({
    where: { id: { in: [session.id, other.id, liveSession.id] } },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
