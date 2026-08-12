import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { api, mintCookie, BASE } from "../tests/isolation/helpers.mjs";

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

async function main() {
  const recruiter = await db.user.findUnique({
    where: { email: "recruiter@local.dev" },
  });
  if (!recruiter) throw new Error("missing recruiter");
  const cookie = await mintCookie(recruiter);

  const page = await fetch(`${BASE}/dashboard/interview-links`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  note("Interview Links page", page.status === 200, `status ${page.status}`);

  const app = await db.application.findFirst({
    where: {
      status: { in: ["ACTIVE", "ON_HOLD"] },
      job: { organizationId: recruiter.organizationId ?? undefined },
    },
  });
  if (!app) throw new Error("no application");

  const token = randomBytes(32).toString("hex");
  const session = await db.interviewSession.create({
    data: {
      applicationId: app.id,
      mode: "AI_ADAPTIVE",
      deliveryMode: "TEXT",
      status: "SCHEDULED",
      interviewType: "TECHNICAL",
      accessToken: token,
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
      interviewerId: recruiter.id,
      scheduledAt: new Date(),
      proctoringEnabled: true,
    },
  });

  const open = await fetch(`${BASE}/api/interview/${token}`);
  const openJ = await open.json();
  note(
    "Active link opens + duration exposed",
    open.status === 200 && openJ.durationMinutes === 30,
    `status ${open.status} duration=${openJ.durationMinutes}`,
  );

  const start = await fetch(`${BASE}/api/interview/${token}/start`, {
    method: "POST",
  });
  const startJ = await start.json();
  if (!start.ok) console.log("start error body", startJ);
  note(
    "Start sets endsAt",
    start.ok && Boolean(startJ.endsAt),
    `status ${start.status} endsAt=${startJ.endsAt}`,
  );

  const { res: exp } = await api(
    cookie,
    "POST",
    `/api/interviews/${session.id}/expire`,
  );
  note("Expire action", exp.status === 200, `status ${exp.status}`);

  const after = await fetch(`${BASE}/api/interview/${token}`);
  const afterJ = await after.json();
  note(
    "Expired/cancelled rejected with recruiter message",
    after.status === 410 &&
      String(afterJ.error || "").includes("Please contact the recruiter"),
    `status ${after.status} ${afterJ.error}`,
  );

  const token2 = randomBytes(32).toString("hex");
  await db.interviewSession.create({
    data: {
      applicationId: app.id,
      mode: "AI_ADAPTIVE",
      deliveryMode: "TEXT",
      status: "SCHEDULED",
      interviewType: "TECHNICAL",
      accessToken: token2,
      tokenExpiresAt: new Date(Date.now() - 1000),
      durationMinutes: 15,
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
      interviewerId: recruiter.id,
      scheduledAt: new Date(),
    },
  });
  const expired = await fetch(`${BASE}/api/interview/${token2}`);
  const expiredJ = await expired.json();
  note(
    "Pre-expired token 410",
    expired.status === 410 &&
      String(expiredJ.error || "").includes("Please contact the recruiter"),
    `status ${expired.status}`,
  );

  const candidate = await db.user.findUnique({
    where: { email: "candidate@local.dev" },
  });
  const candCookie = await mintCookie(candidate);
  const candPage = await fetch(`${BASE}/dashboard/interview-links`, {
    headers: { Cookie: candCookie },
    redirect: "manual",
  });
  note(
    "CANDIDATE denied interview-links",
    candPage.status === 307 || candPage.status === 302,
    `status ${candPage.status} loc=${candPage.headers.get("location")}`,
  );

  const interviewer = await db.user.findUnique({
    where: { email: "interviewer@local.dev" },
  });
  if (interviewer) {
    const iCookie = await mintCookie(interviewer);
    const iPage = await fetch(`${BASE}/dashboard/interview-links`, {
      headers: { Cookie: iCookie },
      redirect: "manual",
    });
    note(
      "INTERVIEWER denied interview-links",
      iPage.status === 307 || iPage.status === 302,
      `status ${iPage.status} loc=${iPage.headers.get("location")}`,
    );
  }

  // Duration enforcement helper: past deadline must be detected server-side.
  const past = new Date(Date.now() - 20 * 60 * 1000);
  const timed = await db.interviewSession.create({
    data: {
      applicationId: app.id,
      mode: "AI_ADAPTIVE",
      deliveryMode: "TEXT",
      status: "IN_PROGRESS",
      interviewType: "TECHNICAL",
      accessToken: randomBytes(32).toString("hex"),
      tokenExpiresAt: new Date(Date.now() + 864e5),
      durationMinutes: 15,
      startedAt: past,
      maxQuestions: 12,
      plan: minimalPlan,
      adaptiveState: {
        currentTopicIndex: 0,
        questionsAsked: 1,
        followUpsOnCurrentTopic: 0,
        topicsCovered: [],
        difficulty: 3,
        concluded: false,
      },
      interviewerId: recruiter.id,
      scheduledAt: past,
    },
  });
  const state = await fetch(`${BASE}/api/interview/${timed.accessToken}/state`);
  const stateJ = await state.json();
  const endsPast =
    stateJ.endsAt && new Date(stateJ.endsAt).getTime() < Date.now();
  note(
    "Duration endsAt in the past for timed-out session",
    state.ok && endsPast,
    `endsAt=${stateJ.endsAt}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
