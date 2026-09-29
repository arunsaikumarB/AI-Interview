/**
 * CEO demo polish for Kavya Menon's completed interview only:
 *   - replaces six identical seeded answer texts with distinct answers
 *   - sets endedAt so the stored duration is a realistic 24m36s (startedAt unchanged)
 * Dry run by default. Pass --apply to execute. Backs up affected rows first.
 *
 * Run: node --env-file=.env scripts/_kavya_demo_polish.mjs [--apply]
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const APP = "cmsxivm86000jyjujodu1hdht";
const SESSION = "cmsxivm950015yjujhbjnpfqy";
const EVAL_ID = "cmsxivma4001zyjujewvh0glm";
const OLD_TEXT =
  "I would start from the operator workflow, constrain the design to what we can run locally, and write down success metrics before adding features. I would persist failures honestly, keep the recruiter as the decision-maker, and document the trade-offs.";
const OLD_ENDED_AT = "2026-08-17T11:43:27.591Z";
const DURATION_MS = (24 * 60 + 36) * 1000;

const BACKUP_DIR = path.join(
  path.resolve(process.env.STORAGE_ROOT || "./storage"),
  "_demo-polish-2026-09-28",
);

/** answerId -> [expected questionId, new answer text] */
const ANSWERS = {
  cmsxivm9h001dyjujkua021d3: [
    "cmsxivm9e001byjujw3juecw6",
    "I'd keep the existing stage-change endpoint stable and add a v2 route alongside it rather than changing the payload in place. New fields are optional and additive, the server maps v1 requests onto the new model, and we log which clients still call v1. Once v1 traffic is zero for a full hiring cycle, we announce a removal date and retire it, so recruiters never hit a breaking change mid-pipeline.",
  ],
  cmsxivm9m001hyjujb23m08y0: [
    "cmsxivm9k001fyjuj3wa5r92x",
    "Most of it belongs in the database, not the UI. Foreign keys from applications to jobs and candidates, a unique constraint on candidate plus job, and enums for stage and status so free text can't creep in. Stage changes go through one service that writes the timeline event in the same transaction, so reports built from the timeline always agree with the current stage.",
  ],
  cmsxivm9q001lyjuj0l8q369g: [
    "cmsxivm9o001jyjujp91e82sj",
    "I'd persist a failure record with the job ID, attempt count, timestamp and a sanitised error message, and mark the evaluation as failed so the recruiter can see it and retry. What I'd never do is write a placeholder score or a default recommendation. A missing evaluation should look missing, not quietly turn into a 'No'.",
  ],
  cmsxivm9u001pyjujx056wrpx: [
    "cmsxivm9s001nyjujq7x3t5uf",
    "First the flags: HttpOnly, SameSite=Lax, and Secure whenever we're on HTTPS. Then expiry and rotation on login and logout, and whether anything new becomes readable from JavaScript. I also confirm authorization is still enforced server-side on every route, because a cookie change should never weaken role checks. I'd want a test that asserts the exact Set-Cookie attributes.",
  ],
  cmsxivm9y001tyjujxestak0h: [
    "cmsxivm9w001ryjuj0ojzrtxl",
    "Queue depth and job latency for the screening workers, success and failure rates per model call, and model response time. Structured logs with request IDs but no resume text or personal data, plus a health endpoint that reports reachability only. And an alert when failures cross a threshold, so we find out before a recruiter does.",
  ],
  cmsxivma2001xyjujdtyvhx2r: [
    "cmsxivma1001vyjuj9r86hmh9",
    "Everything runs in containers inside the LAN: Postgres, Redis, the workers and the model server. Images and models are pulled once and mirrored internally, so nothing reaches the internet at runtime. Backups go to local storage on a schedule, and TLS uses certificates from our internal CA. The trade-off is that updates become a deliberate, scheduled step rather than automatic.",
  ],
};

function fail(msg) {
  throw new Error(`ABORT: ${msg}`);
}

async function main() {
  const session = await prisma.interviewSession.findUnique({
    where: { id: SESSION },
    select: { id: true, applicationId: true, status: true, startedAt: true, endedAt: true },
  });
  if (!session || session.applicationId !== APP) fail("session/application mismatch");
  if (session.status !== "COMPLETED") fail(`session status ${session.status}`);
  if (session.endedAt?.toISOString() !== OLD_ENDED_AT) fail(`unexpected endedAt ${session.endedAt?.toISOString()}`);
  if (!session.startedAt) fail("startedAt missing");

  const answers = await prisma.interviewAnswer.findMany({ where: { sessionId: SESSION } });
  if (answers.length !== 6) fail(`expected 6 answers, found ${answers.length}`);
  for (const a of answers) {
    const plan = ANSWERS[a.id];
    if (!plan) fail(`unexpected answer ${a.id}`);
    if (plan[0] !== a.questionId) fail(`answer ${a.id} question mismatch`);
    if (a.answerText !== OLD_TEXT) fail(`answer ${a.id} text already changed`);
  }
  const newTexts = Object.values(ANSWERS).map((v) => v[1]);
  if (new Set(newTexts).size !== 6) fail("new answers are not distinct");

  const evalBefore = await prisma.aIEvaluation.findMany({ where: { applicationId: APP } });
  const newEndedAt = new Date(session.startedAt.getTime() + DURATION_MS);

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "APPLY" : "DRY RUN",
        answersToUpdate: answers.map((a) => a.id),
        endedAt: { from: OLD_ENDED_AT, to: newEndedAt.toISOString() },
        startedAt: session.startedAt.toISOString(),
        evaluationsOnApplication: evalBefore.length,
      },
      null,
      2,
    ),
  );
  if (!APPLY) return;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, "kavya-backup.json");
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ createdAt: new Date().toISOString(), session, answers }, null, 2),
  );

  await prisma.$transaction(async (tx) => {
    for (const [id, [, text]] of Object.entries(ANSWERS)) {
      await tx.interviewAnswer.update({ where: { id }, data: { answerText: text } });
    }
    await tx.interviewSession.update({ where: { id: SESSION }, data: { endedAt: newEndedAt } });
  });

  const evalAfter = await prisma.aIEvaluation.findMany({ where: { applicationId: APP } });
  const kept = evalAfter.find((e) => e.id === EVAL_ID);
  if (evalAfter.length !== evalBefore.length || kept?.recommendation !== "YES" || kept?.scores?.overall !== 82) {
    fail("evaluation changed unexpectedly");
  }
  console.log(`APPLIED. Backup: ${path.relative(process.cwd(), backupFile)}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
