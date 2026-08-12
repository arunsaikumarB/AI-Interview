import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "aros_session";

/** Fields that must never appear in candidate-facing portal JSON. */
export const SCORE_LEAK_RE =
  /\b(overall|screeningScore|interviewScore|recommendation|reasoning|aiEvaluation|aiEvaluations|score|scores|evaluations?)\b/i;

export function assertNoScoreLeak(label, payload) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (SCORE_LEAK_RE.test(raw)) {
    const m = raw.match(SCORE_LEAK_RE);
    throw new Error(`${label}: score-related field leaked (matched "${m?.[0]}")`);
  }
}

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for isolation tests");
  return new TextEncoder().encode(secret);
}

/** Mint a session cookie for a user — no UI/password handoff. */
export async function mintCookie(user) {
  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secretKey());
  return `${COOKIE_NAME}=${token}`;
}

export async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { res, json, text };
}

export function prisma() {
  return new PrismaClient();
}

/**
 * Two CANDIDATE portal accounts in the same org, each with an application.
 * Victim (B) also gets an AIEvaluation so a leak would be visible.
 */
export async function seedIsolationPair(db) {
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("No organization — run db:seed first");

  const job = await db.job.findFirst({
    where: { organizationId: org.id, status: "OPEN" },
  });
  if (!job) throw new Error("No OPEN job — run db:seed first");

  const stamp = Date.now();
  const passwordHash = await bcrypt.hash("isolation-test-password-ok", 10);

  const userA = await db.user.create({
    data: {
      email: `iso-a-${stamp}@example.com`,
      name: "Isolation Alice",
      role: "CANDIDATE",
      passwordHash,
      organizationId: org.id,
      isActive: true,
    },
  });
  const userB = await db.user.create({
    data: {
      email: `iso-b-${stamp}@example.com`,
      name: "Isolation Bob",
      role: "CANDIDATE",
      passwordHash,
      organizationId: org.id,
      isActive: true,
    },
  });

  const candA = await db.candidate.create({
    data: {
      organizationId: org.id,
      userId: userA.id,
      email: userA.email,
      firstName: "Isolation",
      lastName: "Alice",
      resumeText: "Alice resume — private to Alice",
      resumeUrl: "resumes/iso-alice.txt",
    },
  });
  const candB = await db.candidate.create({
    data: {
      organizationId: org.id,
      userId: userB.id,
      email: userB.email,
      firstName: "Isolation",
      lastName: "Bob",
      resumeText: "Bob SECRET resume text that Alice must never see",
      resumeUrl: "resumes/iso-bob-secret.txt",
      summary: "Bob confidential summary",
    },
  });

  const appA = await db.application.create({
    data: {
      candidateId: candA.id,
      jobId: job.id,
      stage: "APPLIED",
      status: "ACTIVE",
      source: "isolation_test",
    },
  });

  // Bob on a different job if available so titles differ; else same job is fine
  const jobB =
    (await db.job.findFirst({
      where: {
        organizationId: org.id,
        status: "OPEN",
        id: { not: job.id },
      },
    })) ?? job;

  const appB = await db.application.create({
    data: {
      candidateId: candB.id,
      jobId: jobB.id,
      stage: "SCREENING",
      status: "ACTIVE",
      source: "isolation_test",
    },
  });

  await db.aIEvaluation.create({
    data: {
      applicationId: appB.id,
      kind: "RESUME_SCREEN",
      scores: { overall: 91, skills: 90, experience: 88 },
      recommendation: "STRONG_YES",
      reasoning: "SECRET_EVAL_REASONING_BOB_ONLY",
      model: "isolation-test",
      rawResponse: { secret: true, overall: 91 },
    },
  });

  return {
    org,
    userA,
    userB,
    candA,
    candB,
    appA,
    appB,
    job,
    jobB,
  };
}

export async function cleanupIsolationPair(db, pair) {
  if (!pair) return;
  await db.aIEvaluation.deleteMany({
    where: { applicationId: { in: [pair.appA.id, pair.appB.id] } },
  });
  await db.application.deleteMany({
    where: { id: { in: [pair.appA.id, pair.appB.id] } },
  });
  await db.candidate.deleteMany({
    where: { id: { in: [pair.candA.id, pair.candB.id] } },
  });
  await db.user.deleteMany({
    where: { id: { in: [pair.userA.id, pair.userB.id] } },
  });
}
