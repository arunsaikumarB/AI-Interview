/**
 * Removes everything that did not come from the LogiSoft careers page sync, so only careers jobs
 * and their applicants remain. Keeps organizations, departments and staff logins.
 *
 * Deletes: jobs not from the careers page; applications not imported from it (with their
 * timeline, interviews, answers, AI results, proctoring, assessments and links); candidates left
 * with no careers application (with notes and tags); candidate portal logins of deleted
 * candidates; all tags; all email templates; email logs not addressed to a kept candidate.
 * Then deletes stored files nothing refers to any more, but never a file changed after the first
 * careers import started.
 *
 * Run from the app folder (uses its .env: DATABASE_URL, STORAGE_ROOT). Take a backup first.
 *
 *   npm run clean:demo                                   # dry run: shows what would go, writes nothing
 *   npm run clean:demo -- --apply                        # asks you to type the database name
 *   npm run clean:demo -- --apply --confirm-db <name>
 */
import { existsSync } from "node:fs";
import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";

const CAREERS = "wordpress_careers";
const HIREOS_FOLDERS = new Set(["resumes", "interviews", "recordings", "assessments", "misc"]);
const DEMO_FOLDER = /^_(demo-polish|uat-quarantine)-/;

function isHireosFolder(name: string): boolean {
  return HIREOS_FOLDERS.has(name) || DEMO_FOLDER.test(name);
}

type Args = { apply: boolean; confirmDb: string | null };

function parseArgs(argv: string[]): Args {
  const out: Args = { apply: false, confirmDb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--confirm-db") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error("--confirm-db needs a value");
      out.confirmDb = v;
    } else throw new Error(`Unknown option ${a}`);
  }
  return out;
}

type FilePlan = { rel: string; abs: string; bytes: number };

async function walk(root: string, rel = ""): Promise<Array<{ rel: string; abs: string; bytes: number; mtime: Date }>> {
  const dir = path.join(root, rel);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: Array<{ rel: string; abs: string; bytes: number; mtime: Date }> = [];
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const abs = path.join(root, childRel);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) out.push(...(await walk(root, childRel)));
    else if (e.isFile()) {
      const s = await lstat(abs);
      out.push({ rel: childRel, abs, bytes: s.size, mtime: s.mtime });
    }
  }
  return out;
}

async function removeEmptyDirs(dir: string, depth: number): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink()) await removeEmptyDirs(path.join(dir, e.name), depth + 1);
  if (depth >= 2 && (await readdir(dir).catch(() => ["x"])).length === 0) await rmdir(dir).catch(() => undefined);
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[clean:demo] ${err instanceof Error ? err.message : err}`);
    console.error("Usage: npm run clean:demo -- [--apply [--confirm-db <name>]]");
    return 1;
  }
  if (existsSync(".env")) process.loadEnvFile(".env");

  const { prisma } = await import("../src/lib/db");
  const { getStorageRoot } = await import("../src/lib/storage");
  const n = (v: unknown) => Number(v ?? 0);
  let dbChanged = false;

  try {
    const [target] = await prisma.$queryRaw<Array<{ db: string; host: string | null; port: number | null }>>`
      SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;

    const [keep] = await prisma.$queryRaw<Array<Record<string, bigint | Date | null>>>`
      WITH kept_app AS (
        SELECT a.id, a."candidateId" FROM "Application" a JOIN "Job" j ON j.id = a."jobId"
        WHERE a."externalSource" = ${CAREERS} AND j."externalSource" = ${CAREERS}
      )
      SELECT
        (SELECT count(*) FROM "Job" WHERE "externalSource" = ${CAREERS}) AS careers_jobs,
        (SELECT min("createdAt") FROM "Job" WHERE "externalSource" = ${CAREERS}) AS first_import,
        (SELECT count(*) FROM kept_app) AS kept_apps,
        (SELECT count(DISTINCT "candidateId") FROM kept_app) AS kept_candidates,
        (SELECT count(*) FROM "Candidate" c WHERE c.id IN (SELECT "candidateId" FROM kept_app)
           AND c."createdAt" < (SELECT min("createdAt") FROM "Job" WHERE "externalSource" = ${CAREERS})) AS kept_older_candidates,
        (SELECT count(*) FROM "User" WHERE role <> 'CANDIDATE') AS staff_users,
        (SELECT count(*) FROM "Organization") AS orgs,
        (SELECT count(*) FROM "Department") AS departments,
        (SELECT count(*) FROM "Job" WHERE "externalSource" IS DISTINCT FROM ${CAREERS}) AS del_jobs,
        (SELECT count(*) FROM "Application" WHERE id NOT IN (SELECT id FROM kept_app)) AS del_apps,
        (SELECT count(*) FROM "Candidate" WHERE id NOT IN (SELECT "candidateId" FROM kept_app)) AS del_candidates,
        (SELECT count(*) FROM "InterviewSession" WHERE "applicationId" NOT IN (SELECT id FROM kept_app)) AS del_interviews,
        (SELECT count(*) FROM "AIEvaluation" WHERE "applicationId" NOT IN (SELECT id FROM kept_app)) AS del_ai,
        (SELECT count(*) FROM "PracticalAssessment" WHERE "applicationId" NOT IN (SELECT id FROM kept_app)) AS del_practical,
        (SELECT count(*) FROM "TimelineEvent" WHERE "applicationId" NOT IN (SELECT id FROM kept_app)) AS del_timeline,
        (SELECT count(*) FROM "Note" WHERE "candidateId" NOT IN (SELECT "candidateId" FROM kept_app)) AS del_notes,
        (SELECT count(*) FROM "User" u WHERE u.role = 'CANDIDATE' AND u.id NOT IN (
           SELECT "userId" FROM "Candidate" WHERE "userId" IS NOT NULL AND id IN (SELECT "candidateId" FROM kept_app))) AS del_portal_users,
        (SELECT count(*) FROM "Tag") AS del_tags,
        (SELECT count(*) FROM "EmailTemplate") AS del_templates,
        (SELECT count(*) FROM "CommunicationLog" WHERE lower("toAddress") NOT IN (
           SELECT lower(email) FROM "Candidate" WHERE id IN (SELECT "candidateId" FROM kept_app))) AS del_emails`;

    console.log("HireOS: remove everything not from the LogiSoft careers page");
    console.log(`  Database: "${target.db}" on ${target.host ?? "local socket"}${target.port ? `:${target.port}` : ""}`);
    console.log(`  Mode:     ${args.apply ? "APPLY (deletes data and files)" : "dry run (changes nothing)"}`);
    console.log("");
    console.log("Keeps:");
    console.log(`  careers jobs ${n(keep.careers_jobs)}, careers applications ${n(keep.kept_apps)}, their candidates ${n(keep.kept_candidates)}`);
    if (n(keep.kept_older_candidates)) {
      console.log(`    (${n(keep.kept_older_candidates)} of these candidates existed before the careers import; their other applications go)`);
    }
    console.log(`  organizations ${n(keep.orgs)}, departments ${n(keep.departments)}, staff logins ${n(keep.staff_users)}`);
    console.log("Deletes:");
    console.log(`  jobs ${n(keep.del_jobs)}, applications ${n(keep.del_apps)}, candidates ${n(keep.del_candidates)}`);
    console.log(
      `  interviews ${n(keep.del_interviews)}, AI results ${n(keep.del_ai)}, practical assessments ${n(keep.del_practical)}, timeline entries ${n(keep.del_timeline)}`,
    );
    console.log(
      `  notes ${n(keep.del_notes)}, candidate portal logins ${n(keep.del_portal_users)}, tags ${n(keep.del_tags)}, email templates ${n(keep.del_templates)}, email log entries ${n(keep.del_emails)}`,
    );

    if (n(keep.careers_jobs) === 0 || n(keep.kept_apps) === 0) {
      console.error("");
      console.error("[clean:demo] No careers page data found. Run the careers sync first. Nothing was changed.");
      return 1;
    }
    const cutoff = keep.first_import as Date;

    const storageRoot = getStorageRoot();
    const planFiles = async (): Promise<FilePlan[]> => {
      const [refs, sessions, apps] = await Promise.all([
        prisma.$queryRaw<Array<{ p: string }>>`
          SELECT "resumeUrl" AS p FROM "Candidate" WHERE "resumeUrl" IS NOT NULL
          UNION SELECT "ttsPath" FROM "InterviewQuestion" WHERE "ttsPath" IS NOT NULL
          UNION SELECT "audioPath" FROM "InterviewAnswer" WHERE "audioPath" IS NOT NULL
          UNION SELECT "secondaryRecordingPath" FROM "InterviewSession" WHERE "secondaryRecordingPath" IS NOT NULL`,
        prisma.interviewSession.findMany({ select: { id: true, secondaryRecordingId: true } }),
        prisma.application.findMany({ select: { id: true } }),
      ]);
      const referenced = new Set(refs.map((r) => r.p.replace(/\\/g, "/").replace(/^\/+/, "")));
      const sessionIds = new Set(sessions.map((s) => s.id));
      const tokens = [
        ...sessions.flatMap((s) => [s.id, s.secondaryRecordingId].filter((v): v is string => Boolean(v))),
        ...apps.map((a) => a.id),
      ];
      const files = await walk(storageRoot);
      return files
        .filter((f) => {
          const top = f.rel.split("/")[0];
          if (!f.rel.includes("/") || !isHireosFolder(top)) return false;
          if (f.mtime >= cutoff) return false;
          if (referenced.has(f.rel)) return false;
          if (DEMO_FOLDER.test(top) || top === "resumes") return true;
          if (top === "interviews") return !sessionIds.has(f.rel.split("/")[1] ?? "");
          return !tokens.some((t) => f.rel.includes(t));
        })
        .map(({ rel, abs, bytes }) => ({ rel, abs, bytes }));
    };
    const reportOtherFolders = async () => {
      const entries = await readdir(storageRoot, { withFileTypes: true }).catch(() => []);
      const other = entries
        .filter((e) => e.isDirectory() && !isHireosFolder(e.name) && e.name !== "queue" && e.name !== "integrations")
        .map((e) => `${e.name}/`);
      if (other.length) console.log(`Left alone (not HireOS folders): ${other.join(", ")}`);
    };

    if (!args.apply) {
      const files = await planFiles();
      const byTop = new Map<string, { count: number; bytes: number }>();
      for (const f of files) {
        const top = f.rel.split("/")[0];
        const cur = byTop.get(top) ?? { count: 0, bytes: 0 };
        cur.count++;
        cur.bytes += f.bytes;
        byTop.set(top, cur);
      }
      console.log(`  stored files (estimate before the database clean-up; the real run removes more):`);
      for (const [top, v] of Array.from(byTop)) console.log(`    ${top}/  ${v.count} file(s), ${mb(v.bytes)}`);
      if (byTop.size === 0) console.log("    none");
      console.log("");
      console.log(`Storage: ${storageRoot}  (files changed after ${cutoff.toISOString()} are never deleted)`);
      await reportOtherFolders();
      console.log("Dry run only. Nothing was changed. Take a backup, then re-run with --apply.");
      return 0;
    }

    let confirm = args.confirmDb;
    if (confirm === null) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error("[clean:demo] --apply needs an interactive terminal or --confirm-db <database name>. Nothing was changed.");
        return 1;
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      confirm = await rl.question(`Type the database name "${target.db}" to delete the data above: `);
      rl.close();
    }
    if (confirm.trim() !== target.db) {
      console.error("[clean:demo] Confirmation did not match the database name. Nothing was changed.");
      return 1;
    }

    const done = await prisma.$transaction(
      async (tx) => {
        const apps = await tx.$executeRaw`
          DELETE FROM "Application" a USING "Job" j
          WHERE a."jobId" = j.id
            AND (a."externalSource" IS DISTINCT FROM ${CAREERS} OR j."externalSource" IS DISTINCT FROM ${CAREERS})`;
        const jobs = await tx.$executeRaw`DELETE FROM "Job" WHERE "externalSource" IS DISTINCT FROM ${CAREERS}`;
        const candidates = await tx.$executeRaw`
          DELETE FROM "Candidate" c WHERE NOT EXISTS (SELECT 1 FROM "Application" a WHERE a."candidateId" = c.id)`;
        const portal = await tx.$executeRaw`
          DELETE FROM "User" WHERE role = 'CANDIDATE'
            AND id NOT IN (SELECT "userId" FROM "Candidate" WHERE "userId" IS NOT NULL)`;
        const emails = await tx.$executeRaw`
          DELETE FROM "CommunicationLog" WHERE lower("toAddress") NOT IN (SELECT lower(email) FROM "Candidate")`;
        const tags = await tx.$executeRaw`DELETE FROM "Tag"`;
        const templates = await tx.$executeRaw`DELETE FROM "EmailTemplate"`;
        const [left] = await tx.$queryRaw<Array<{ jobs: bigint; apps: bigint }>>`
          SELECT (SELECT count(*) FROM "Job" WHERE "externalSource" IS DISTINCT FROM ${CAREERS}) AS jobs,
                 (SELECT count(*) FROM "Application" WHERE "externalSource" IS DISTINCT FROM ${CAREERS}) AS apps`;
        if (n(left.jobs) !== 0 || n(left.apps) !== 0) throw new Error("non-careers rows remain");
        return { apps, jobs, candidates, portal, emails, tags, templates };
      },
      { timeout: 10 * 60 * 1000, maxWait: 30_000 },
    );
    dbChanged = true;
    console.log("");
    console.log(
      `Database done. Deleted: jobs ${done.jobs}, applications ${done.apps}, candidates ${done.candidates}, ` +
        `portal logins ${done.portal}, email log entries ${done.emails}, tags ${done.tags}, email templates ${done.templates}.`,
    );

    const files = await planFiles();
    let removed = 0;
    let bytes = 0;
    let failed = 0;
    for (const f of files) {
      try {
        await rm(f.abs, { force: true });
        removed++;
        bytes += f.bytes;
      } catch {
        failed++;
      }
    }
    for (const top of Array.from(HIREOS_FOLDERS)) await removeEmptyDirs(path.join(storageRoot, top), 1);
    for (const e of await readdir(storageRoot, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && DEMO_FOLDER.test(e.name)) await removeEmptyDirs(path.join(storageRoot, e.name), 1);
    }
    await reportOtherFolders();
    console.log(`Files done. Deleted ${removed} file(s), ${mb(bytes)}${failed ? `; ${failed} could not be deleted` : ""}.`);
    return failed ? 2 : 0;
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? ` (${String((err as { code: unknown }).code)})` : "";
    console.error(
      `[clean:demo] Failed${code}. ${dbChanged ? "The database clean-up was saved; re-run with --apply to finish the files." : "The database was not changed."}`,
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  () => process.exit(1),
);
