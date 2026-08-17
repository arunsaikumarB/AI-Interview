/**
 * Existing ensureQuestionTts. tsx scripts/prefetch-question-tts.mjs <sessionId> <organizationId> <questionId> <out.json>
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sessionId = process.argv[2];
const organizationId = process.argv[3];
const questionId = process.argv[4];
const outPath = process.argv[5];

async function writeOut(payload) {
  await writeFile(outPath, JSON.stringify(payload), "utf8");
}

function fail(errorClass, retryable = false) {
  return { ok: false, error_class: errorClass, retryable };
}

async function main() {
  if (!sessionId || !organizationId || !questionId || !outPath) {
    await writeOut(fail("invalid_args"));
    process.exit(2);
  }
  const { prisma } = await import(
    pathToFileURL(path.join(process.cwd(), "src/lib/db.ts")).href
  );
  const { ensureQuestionTts } = await import(
    pathToFileURL(path.join(process.cwd(), "src/lib/question-tts.ts")).href
  );

  const question = await prisma.interviewQuestion.findUnique({
    where: { id: questionId },
    include: {
      session: {
        include: { application: { include: { job: { select: { organizationId: true } } } } },
      },
    },
  });
  if (!question || question.sessionId !== sessionId) {
    await writeOut(fail("invalid_question"));
    process.exit(1);
  }
  if (question.session.application.job.organizationId !== organizationId) {
    await writeOut(fail("invalid_session"));
    process.exit(1);
  }

  const relativePath = await ensureQuestionTts({
    sessionId,
    questionId,
    sequence: question.sequence,
    text: question.question,
    existingPath: question.ttsPath,
  });

  await writeOut({
    ok: true,
    session_id: sessionId,
    question_id: questionId,
    sequence: question.sequence,
    cached: Boolean(question.ttsPath),
    has_tts_path: Boolean(relativePath),
  });
}

main().catch(async (err) => {
  const name = err && typeof err === "object" ? err.name : "";
  const retryable = name === "SpeechError";
  try {
    await writeOut({
      ...fail(retryable ? "speech_unavailable" : "tts_failed", retryable),
    });
  } catch {
    /* ignore */
  }
  process.exit(retryable ? 3 : 1);
});
