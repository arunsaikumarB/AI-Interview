/**
 * Existing generatePlan for a SCHEDULED InterviewSession. IDs only on argv.
 * tsx scripts/generate-interview-plan.mjs <sessionId> <organizationId> <out.json> [--fingerprint]
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sessionId = process.argv[2];
const organizationId = process.argv[3];
const outPath = process.argv[4];
const fingerprintOnly = process.argv.includes("--fingerprint");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function writeOut(payload) {
  await writeFile(outPath, JSON.stringify(payload), "utf8");
}

function fail(errorClass, retryable = false) {
  return { ok: false, error_class: errorClass, retryable };
}

async function main() {
  if (!sessionId || !organizationId || !outPath) {
    await writeOut(fail("invalid_args"));
    process.exit(2);
  }
  const prismaUrl = pathToFileURL(path.join(process.cwd(), "src/lib/db.ts")).href;
  const interviewUrl = pathToFileURL(
    path.join(process.cwd(), "src/lib/ai/interview.ts"),
  ).href;
  const screeningUrl = pathToFileURL(
    path.join(process.cwd(), "src/lib/ai/screening.ts"),
  ).href;
  const sessionUrl = pathToFileURL(
    path.join(process.cwd(), "src/lib/ai/interview-session.ts"),
  ).href;

  const { prisma } = await import(prismaUrl);
  const { PLAN_SYSTEM, generatePlan } = await import(interviewUrl);
  const { ScreeningResultSchema } = await import(screeningUrl);
  const { asJson, initialAdaptiveState, parsePlan } = await import(sessionUrl);

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      application: {
        include: {
          job: true,
          candidate: true,
          aiEvaluations: {
            where: { kind: "RESUME_SCREEN" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!session) {
    await writeOut(fail("invalid_session"));
    process.exit(1);
  }
  if (session.application.job.organizationId !== organizationId) {
    await writeOut(fail("invalid_session"));
    process.exit(1);
  }

  const latestScreen = session.application.aiEvaluations[0];
  const screeningFocus = latestScreen
    ? ScreeningResultSchema.safeParse(latestScreen.scores).data ?? null
    : null;
  const resumeText = session.application.candidate.resumeText?.trim() ?? "";

  const user = [
    `Interview type: ${session.interviewType}`,
    `Job title: ${session.application.job.title}`,
    `Job description:\n${session.application.job.description}`,
    `Job skills: ${(session.application.job.skills ?? []).join(", ")}`,
    `Experience range: ${session.application.job.experienceMin}${
      session.application.job.experienceMax != null
        ? `–${session.application.job.experienceMax}`
        : "+"
    } years`,
    `Screening criteria: ${JSON.stringify(session.application.job.screeningCriteria ?? {})}`,
    `Latest screening focusAreas/gaps (keep only if they match the JD): ${JSON.stringify(
      screeningFocus?.missingRequirements?.length || screeningFocus?.concerns?.length
        ? [
            ...(screeningFocus.missingRequirements ?? []),
            ...(screeningFocus.concerns ?? []),
          ]
        : [],
    )}`,
    `Candidate: ${session.application.candidate.firstName} ${session.application.candidate.lastName}`,
    `Candidate skills (do NOT turn these into topics unless they also appear in job skills/JD): ${session.application.candidate.skills.join(", ")}`,
    `Candidate experience years: ${session.application.candidate.experience}`,
    `Candidate summary: ${session.application.candidate.summary ?? "(none)"}`,
    `Resume text (use only to probe JD-relevant claims):\n${resumeText.slice(0, 4000) || "(none)"}`,
  ].join("\n");

  if (fingerprintOnly) {
    let topicCount = 0;
    try {
      topicCount = parsePlan(session.plan).topics.length;
    } catch {
      topicCount = 0;
    }
    await writeOut({
      ok: true,
      fingerprint: true,
      session_id: sessionId,
      application_id: session.applicationId,
      status: session.status,
      system_prompt_sha256: sha256(PLAN_SYSTEM),
      user_prompt_sha256: sha256(user),
      prompt_sha256: sha256(`${PLAN_SYSTEM}\n${user}`),
      existing_topic_count: topicCount,
    });
    return;
  }

  if (session.status !== "SCHEDULED") {
    await writeOut(fail("session_not_scheduled"));
    process.exit(1);
  }

  const { plan, model } = await generatePlan({
    job: session.application.job,
    candidate: {
      firstName: session.application.candidate.firstName,
      lastName: session.application.candidate.lastName,
      summary: session.application.candidate.summary,
      skills: session.application.candidate.skills,
      experience: session.application.candidate.experience,
    },
    resumeText,
    interviewType: session.interviewType,
    screeningFocus,
  });

  const statusBefore = session.status;
  await prisma.interviewSession.update({
    where: { id: session.id },
    data: {
      plan: asJson(plan),
      adaptiveState: asJson(initialAdaptiveState(plan.openingQuestion.difficulty)),
    },
  });
  const after = await prisma.interviewSession.findUnique({
    where: { id: session.id },
    select: { status: true },
  });

  await writeOut({
    ok: true,
    session_id: sessionId,
    model,
    topic_count: plan.topics.length,
    opening_topic: plan.openingQuestion.topic,
    status_unchanged: after?.status === statusBefore,
    application_stage_untouched: true,
  });
}

main().catch(async (err) => {
  const code = err && typeof err === "object" ? err.code : undefined;
  const retryable = code === "OLLAMA_UNREACHABLE" || code === "OLLAMA_HTTP";
  try {
    await writeOut({
      ...fail(retryable ? "ollama_unavailable" : "plan_generation_failed", retryable),
    });
  } catch {
    /* ignore */
  }
  process.exit(retryable ? 3 : 1);
});
