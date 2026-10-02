/**
 * Import job listings exported from the company careers website into HireOS.
 * Every job is created as DRAFT; HR reviews it and sets it to Open. Existing
 * jobs (same title) are never changed. Run from the app folder so it uses the
 * app's .env (DATABASE_URL).
 *
 *   npm run import:jobs -- --file docs/careers-website-jobs.json --created-by <staff email> [--org <slug>]
 *   npm run import:jobs -- ... --apply                 # asks you to type the database name
 *   npm run import:jobs -- ... --apply --confirm-db <database name>
 *
 * Without --apply it is a dry run and writes nothing.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";

type Args = {
  file: string;
  createdBy: string;
  org: string | null;
  apply: boolean;
  confirmDb: string | null;
};

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { org: null, apply: false, confirmDb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--file") out.file = next();
    else if (a === "--created-by") out.createdBy = next().trim().toLowerCase();
    else if (a === "--org") out.org = next();
    else if (a === "--apply") out.apply = true;
    else if (a === "--confirm-db") out.confirmDb = next();
    else throw new Error(`Unknown option ${a}`);
  }
  if (!out.file || !out.createdBy) throw new Error("--file and --created-by are required");
  return out as Args;
}

const MANAGER_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITER"] as const;

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[import:jobs] ${err instanceof Error ? err.message : err}`);
    console.error(
      "Usage: npm run import:jobs -- --file <jobs.json> --created-by <staff email> [--org <slug>] [--apply [--confirm-db <name>]]",
    );
    return 1;
  }

  if (existsSync(".env")) process.loadEnvFile(".env");

  const { prisma } = await import("../src/lib/db");
  const { JOB_IMPORT_FILE_MAX_BYTES, JobImportError, importJob, planJobImport } = await import(
    "../src/lib/job-import"
  );

  try {
    const filePath = path.resolve(args.file);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      console.error("[import:jobs] --file is not a file.");
      return 1;
    }
    if (info.size > JOB_IMPORT_FILE_MAX_BYTES) {
      console.error("[import:jobs] The file is larger than 2 MB.");
      return 1;
    }

    const [target] = await prisma.$queryRaw<Array<{ db: string; host: string | null; port: number | null }>>`
      SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;

    const orgs = await prisma.organization.findMany({ select: { id: true, name: true, slug: true } });
    const org = args.org ? orgs.find((o) => o.slug === args.org) : orgs.length === 1 ? orgs[0] : undefined;
    if (!org) {
      console.error(
        args.org
          ? `[import:jobs] No organization with slug "${args.org}".`
          : `[import:jobs] ${orgs.length} organizations exist; pass --org <slug>.`,
      );
      if (orgs.length) console.error(`  Slugs: ${orgs.map((o) => o.slug).join(", ")}`);
      return 1;
    }

    const creator = await prisma.user.findFirst({
      where: {
        email: args.createdBy,
        isActive: true,
        role: { in: [...MANAGER_ROLES] },
        OR: [{ organizationId: org.id }, { role: "SUPER_ADMIN" }],
      },
      select: { id: true, role: true },
    });
    if (!creator) {
      console.error(
        "[import:jobs] --created-by must be the email of an active SUPER_ADMIN, HR_ADMIN or RECRUITER in this organization.",
      );
      return 1;
    }

    console.log("HireOS job import (careers website)");
    console.log(`  Database:     "${target.db}" on ${target.host ?? "local socket"}${target.port ? `:${target.port}` : ""}`);
    console.log(`  Organization: ${org.name} (slug "${org.slug}")`);
    console.log(`  Created by:   ${args.createdBy} (${creator.role})`);
    console.log(`  Status:       DRAFT (HR sets each job to Open after review)`);
    console.log(`  Mode:         ${args.apply ? "APPLY (writes to the database)" : "dry run (writes nothing)"}`);
    console.log("");

    const plan = await planJobImport({
      prisma,
      organizationId: org.id,
      jsonText: await readFile(filePath, "utf8"),
    });

    for (const r of plan.ready) {
      const exp = `${r.draft.experienceMin}${r.draft.experienceMax === null ? "+" : `-${r.draft.experienceMax}`} yrs`;
      const dept = r.departmentName
        ? r.departmentFound
          ? `, department "${r.departmentName}"`
          : `, department "${r.departmentName}" not in HireOS (left empty)`
        : "";
      console.log(`  job ${r.index}  "${r.draft.title}"  READY (${exp}, ${r.draft.openings} opening(s)${dept})`);
    }
    for (const s of plan.skipped) {
      console.log(`  job ${s.index}  "${s.title}"  SKIP: ${s.reasons.join("; ")}`);
    }
    console.log("");
    console.log(`Ready: ${plan.ready.length}   Skipped: ${plan.skipped.length}`);

    if (!args.apply) {
      console.log("Dry run only. Nothing was written. Re-run with --apply to create the ready jobs as DRAFT.");
      return 0;
    }
    if (plan.ready.length === 0) {
      console.log("Nothing to import.");
      return 0;
    }

    let confirm = args.confirmDb;
    if (confirm === null) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error("[import:jobs] --apply needs an interactive terminal or --confirm-db <database name>. Nothing was written.");
        return 1;
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      confirm = await rl.question(`Type the database name "${target.db}" to create ${plan.ready.length} DRAFT job(s): `);
      rl.close();
    }
    if (confirm.trim() !== target.db) {
      console.error("[import:jobs] Confirmation did not match the database name. Nothing was written.");
      return 1;
    }

    const counts = { created: 0, skipped: 0, failed: 0 };
    for (const job of plan.ready) {
      const label = `  job ${job.index}  "${job.draft.title}"`;
      try {
        const result = await importJob({ prisma, organizationId: org.id, createdById: creator.id, job });
        if (result.status === "CREATED") {
          counts.created += 1;
          console.log(`${label}  CREATED as DRAFT`);
        } else {
          counts.skipped += 1;
          console.log(`${label}  SKIPPED: ${result.reason}`);
        }
      } catch (err) {
        counts.failed += 1;
        const code = typeof err === "object" && err && "code" in err ? ` (${String((err as { code: unknown }).code)})` : "";
        console.log(`${label}  FAILED${code}; nothing was saved for this job`);
      }
    }

    console.log("");
    console.log(`Done. Jobs created (DRAFT): ${counts.created}  Skipped: ${counts.skipped}  Failed: ${counts.failed}`);
    if (counts.created) console.log("Next: HR opens each job in HireOS (Jobs -> open the job -> Edit Job -> Status: Open -> save).");
    return counts.failed ? 2 : 0;
  } catch (err) {
    if (err instanceof JobImportError) {
      console.error(`[import:jobs] ${err.message} Nothing was written.`);
    } else {
      const code = typeof err === "object" && err && "code" in err ? ` (${String((err as { code: unknown }).code)})` : "";
      console.error(`[import:jobs] Failed${code}.`);
    }
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  () => process.exit(1),
);
