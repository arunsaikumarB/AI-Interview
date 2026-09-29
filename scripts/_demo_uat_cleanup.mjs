/**
 * Removes verified live-test (UAT) residue from the CEO demo database.
 * Dry run by default. Pass --apply to execute.
 *
 * Every row removed is exported to a JSON backup and interview storage folders are
 * moved (not deleted) into storage/_uat-quarantine-2026-09-28/ so the cleanup is reversible.
 *
 * Run: node --env-file=.env scripts/_demo_uat_cleanup.mjs [--apply]
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || "./storage");
const QUARANTINE = path.join(STORAGE_ROOT, "_uat-quarantine-2026-09-28");

/** sessionId -> expected applicationId (verified from evidence scripts). */
const UAT_SESSIONS = {
  cmt4u8vyr0001wj4pb7nt4kwv: "cmsxivm8z0012yjuj1gaw24tu", // Nathan Brooks
  cmt4ukzc6002hwj4p11c5mege: "cmsxivm8v000zyjujvv5febt5", // Leah Chen
  cmt5grgsq00019qc4qz3r6f6j: "cmsx4n2nw002li2vofw7jmhhe", // Karthik Nair
  cmt5intns0001v6td3n5yctmc: "cmsx4n2nw002li2vofw7jmhhe", // Karthik Nair
  cmtywbmu30001spdftoj48u4t: "cmsx4n2nw002li2vofw7jmhhe", // Karthik Nair
  cmtywgmj5001cspdfklirti1o: "cmsx4n2nb0026i2vo6vklji5t", // Michael Carter
  cmucr55sq000429y5krn2s7wh: "cmsxivm86000jyjujodu1hdht", // Kavya Menon
};

const SEED_SESSION_IDS = new Set([
  "cmsx4n2ow003fi2vod9qcl1pn",
  "cmsx4n2q5004di2voxxwpmjd3",
  "cmsx4n2r9005bi2vovmfqe3l2",
  "cmsx4n2sd0069i2vobfz11sxr",
  "cmsx4n2ss006li2vo34978ho6",
  "cmsx4n2t3006vi2vouwgj18y4",
  "cmsxivm950015yjujhbjnpfqy",
  "cmsxivmaa0023yjujyur6o02r",
  "cmsxivmam002fyjujs2imwu1h",
]);

const EXPECTED_EVAL_IDS = new Set([
  "cmt4udsaq000pwj4pln0lzsq7",
  "cmt4uff1h001dwj4ph79kqjhp",
  "cmt4uw2aa0076wj4pmmkricti",
  "cmt4usxxn0074wj4pbk3slosf",
  "cmt5iwip5007uv6tdo89t3uye",
  "cmt5ixpbm008ov6tdo6cjppl5",
  "cmt5iy8yi008qv6tdf8f9v2gu",
]);

const KAVYA_APP = "cmsxivm86000jyjujodu1hdht";
const KAVYA_UAT_STAGE_ACTOR = "cmsp3apxa000a2ezw6ccm6l80";

function fail(msg) {
  throw new Error(`ABORT: ${msg}`);
}

function payloadSessionId(p) {
  if (!p || typeof p !== "object") return null;
  return p.sessionId ?? p.interviewSessionId ?? null;
}

async function main() {
  const sessionIds = Object.keys(UAT_SESSIONS);
  for (const id of sessionIds) if (SEED_SESSION_IDS.has(id)) fail(`seed session in UAT list: ${id}`);

  const sessions = await prisma.interviewSession.findMany({ where: { id: { in: sessionIds } } });
  if (sessions.length !== sessionIds.length) fail(`expected ${sessionIds.length} sessions, found ${sessions.length}`);
  for (const s of sessions) {
    if (UAT_SESSIONS[s.id] !== s.applicationId) fail(`session ${s.id} application mismatch`);
  }

  const questions = await prisma.interviewQuestion.findMany({ where: { sessionId: { in: sessionIds } } });
  const answers = await prisma.interviewAnswer.findMany({ where: { sessionId: { in: sessionIds } } });
  const proctoring = await prisma.proctoringEvent.findMany({ where: { sessionId: { in: sessionIds } } });

  const evaluations = await prisma.aIEvaluation.findMany({ where: { sessionId: { in: sessionIds } } });
  for (const e of evaluations) {
    if (!EXPECTED_EVAL_IDS.has(e.id)) fail(`unexpected evaluation on UAT session: ${e.id}`);
    if (String(e.model ?? "").startsWith("demo-seed")) fail(`demo-seed evaluation on UAT session: ${e.id}`);
  }
  if (evaluations.length !== EXPECTED_EVAL_IDS.size) {
    fail(`expected ${EXPECTED_EVAL_IDS.size} UAT evaluations, found ${evaluations.length}`);
  }

  const appIds = [...new Set(Object.values(UAT_SESSIONS))];
  const appTimeline = await prisma.timelineEvent.findMany({ where: { applicationId: { in: appIds } } });
  const sessionSet = new Set(sessionIds);
  const timeline = appTimeline.filter((t) => sessionSet.has(payloadSessionId(t.payload)));

  const kavyaApp = await prisma.application.findUnique({
    where: { id: KAVYA_APP },
    select: { id: true, stage: true, status: true, updatedAt: true },
  });
  const kavyaStageEvents = appTimeline.filter(
    (t) =>
      t.applicationId === KAVYA_APP &&
      t.type === "STAGE_CHANGED" &&
      t.payload?.from === "AI_INTERVIEW" &&
      t.payload?.to === "TECH_INTERVIEW" &&
      (t.payload?.actorId ?? t.payload?.byUserId ?? t.payload?.by) === KAVYA_UAT_STAGE_ACTOR &&
      t.createdAt.toISOString().startsWith("2026-09-22"),
  );
  const revertKavya = kavyaApp?.stage === "TECH_INTERVIEW" && kavyaStageEvents.length === 1;

  const dirs = sessionIds
    .map((id) => ({ id, src: path.join(STORAGE_ROOT, "interviews", id) }))
    .filter((d) => fs.existsSync(d.src));

  const plan = {
    mode: APPLY ? "APPLY" : "DRY RUN",
    sessions: sessions.length,
    questions: questions.length,
    answers: answers.length,
    proctoringEvents: proctoring.length,
    aiEvaluations: evaluations.length,
    timelineEvents: timeline.length,
    kavya: revertKavya
      ? { from: "TECH_INTERVIEW", to: "AI_INTERVIEW", removeStageEvent: kavyaStageEvents[0].id }
      : { skipped: true, stage: kavyaApp?.stage, matchingEvents: kavyaStageEvents.length },
    storageDirsToQuarantine: dirs.map((d) => d.id),
    quarantine: path.relative(process.cwd(), QUARANTINE),
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!APPLY) return;

  fs.mkdirSync(QUARANTINE, { recursive: true });
  const backupFile = path.join(QUARANTINE, "db-backup.json");
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        sessions,
        questions,
        answers,
        proctoring,
        evaluations,
        timeline,
        kavya: revertKavya ? { application: kavyaApp, stageEvent: kavyaStageEvents[0] } : null,
      },
      null,
      2,
    ),
  );

  await prisma.$transaction(async (tx) => {
    const ev = await tx.aIEvaluation.deleteMany({ where: { id: { in: evaluations.map((e) => e.id) } } });
    const tl = await tx.timelineEvent.deleteMany({ where: { id: { in: timeline.map((t) => t.id) } } });
    const ss = await tx.interviewSession.deleteMany({ where: { id: { in: sessionIds } } });
    if (ev.count !== evaluations.length || tl.count !== timeline.length || ss.count !== sessions.length) {
      fail("delete count mismatch — transaction rolled back");
    }
    if (revertKavya) {
      await tx.timelineEvent.delete({ where: { id: kavyaStageEvents[0].id } });
      await tx.application.update({ where: { id: KAVYA_APP }, data: { stage: "AI_INTERVIEW" } });
    }
  });

  const qDir = path.join(QUARANTINE, "interviews");
  fs.mkdirSync(qDir, { recursive: true });
  for (const d of dirs) fs.renameSync(d.src, path.join(qDir, d.id));

  console.log(`APPLIED. Backup: ${path.relative(process.cwd(), backupFile)}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
