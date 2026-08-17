/**
 * Existing finalEvaluation for a COMPLETED session. Same writes as regenerate-evaluation.
 * tsx scripts/finalize-interview.mjs <sessionId> <organizationId> <out.json>
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sessionId = process.argv[2];
const organizationId = process.argv[3];
const outPath = process.argv[4];

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
  const { prisma } = await import(
    pathToFileURL(path.join(process.cwd(), "src/lib/db.ts")).href
  );
  const { finalEvaluation, mapFinalRecommendation } = await import(
    pathToFileURL(path.join(process.cwd(), "src/lib/ai/interview.ts")).href
  );
  const { asJson, parseAdaptiveState, parsePlan, turnsFromQuestions } = await import(
    pathToFileURL(path.join(process.cwd(), "src/lib/ai/interview-session.ts")).href
  );

  const interview = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      application: { include: { job: true, candidate: true } },
      questions: { orderBy: { sequence: "asc" }, include: { answer: true } },
    },
  });
  if (!interview) {
    await writeOut(fail("invalid_session"));
    process.exit(1);
  }
  if (interview.application.job.organizationId !== organizationId) {
    await writeOut(fail("invalid_session"));
    process.exit(1);
  }
  if (interview.status !== "COMPLETED") {
    await writeOut(fail("session_not_completed"));
    process.exit(1);
  }

  const plan = parsePlan(interview.plan);
  const adaptiveState = parseAdaptiveState(interview.adaptiveState);
  const turns = turnsFromQuestions(interview.questions);
  if (turns.length === 0) {
    await writeOut(fail("no_answered_turns"));
    process.exit(1);
  }

  const statusBefore = interview.status;
  const { result, model, raw } = await finalEvaluation({
    plan,
    interviewType: interview.interviewType,
    jobTitle: interview.application.job.title,
    jobDescription: interview.application.job.description,
    resumeText: interview.application.candidate.resumeText ?? "",
    turns,
    adaptiveState: { ...adaptiveState, concluded: true },
  });

  const evaluation = await prisma.aIEvaluation.create({
    data: {
      applicationId: interview.applicationId,
      sessionId: interview.id,
      kind: "INTERVIEW_OVERALL",
      scores: asJson(result),
      recommendation: mapFinalRecommendation(result.recommendation),
      reasoning: result.reasoning,
      model,
      rawResponse: asJson(raw),
    },
  });

  await prisma.timelineEvent.create({
    data: {
      applicationId: interview.applicationId,
      type: "AI_EVALUATION",
      payload: {
        sessionId: interview.id,
        kind: "INTERVIEW_OVERALL",
        overall: result.overall,
        recommendation: result.recommendation,
        regenerated: true,
        celery: true,
        advisoryOnly: true,
      },
    },
  });

  const after = await prisma.interviewSession.findUnique({
    where: { id: interview.id },
    select: { status: true },
  });

  await writeOut({
    ok: true,
    session_id: sessionId,
    evaluation_id: evaluation.id,
    kind: "INTERVIEW_OVERALL",
    recommendation: evaluation.recommendation,
    overall: result.overall,
    model: evaluation.model,
    status_unchanged: after?.status === statusBefore,
  });
}

main().catch(async (err) => {
  const code = err && typeof err === "object" ? err.code : undefined;
  const retryable = code === "OLLAMA_UNREACHABLE" || code === "OLLAMA_HTTP";
  try {
    await writeOut({
      ...fail(retryable ? "ollama_unavailable" : "finalize_failed", retryable),
    });
  } catch {
    /* ignore */
  }
  process.exit(retryable ? 3 : 1);
});
