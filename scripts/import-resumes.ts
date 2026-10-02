/**
 * Bulk import of existing resumes: a folder of PDF/DOCX/TXT files plus a CSV
 * manifest. Operator action on the app server, run from the app folder so it
 * uses the app's .env (DATABASE_URL, STORAGE_ROOT, Ollama).
 *
 *   npm run import:resumes -- --dir /path/to/resumes --csv /path/to/list.csv [--org <slug>]
 *   npm run import:resumes -- --dir ... --csv ... --apply
 *
 * Without --apply it is a dry run and writes nothing. --apply needs an
 * interactive terminal and the database name typed to confirm. Logs show row
 * numbers and file names only (no candidate details or resume text).
 * See docs/DEPLOYMENT-CENTOS9.md, "Importing existing resumes".
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";

type Args = { dir: string; csv: string; org: string | null; apply: boolean };

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { org: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--dir") out.dir = next();
    else if (a === "--csv") out.csv = next();
    else if (a === "--org") out.org = next();
    else if (a === "--apply") out.apply = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!out.dir || !out.csv) throw new Error("--dir and --csv are required");
  return out as Args;
}

const ACTION_LABEL = {
  NEW_CANDIDATE: "new candidate (talent pool, no job)",
  NEW_CANDIDATE_AND_APPLICATION: "new candidate + application",
  APPLICATION_FOR_EXISTING: "application for existing candidate (profile kept)",
} as const;

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[import:resumes] ${err instanceof Error ? err.message : err}`);
    console.error("Usage: npm run import:resumes -- --dir <resume folder> --csv <list.csv> [--org <slug>] [--apply]");
    return 1;
  }

  if (existsSync(".env")) process.loadEnvFile(".env");

  const { prisma } = await import("../src/lib/db");
  const { getStorageRoot } = await import("../src/lib/storage");
  const { extractResumeText } = await import("../src/lib/resume/parse");
  const { embedCandidate } = await import("../src/lib/ai/embeddings");
  const { IMPORT_CSV_MAX_BYTES, ImportError, importRow, planImport } = await import(
    "../src/lib/resume-import"
  );

  try {
    const dir = path.resolve(args.dir);
    const csvPath = path.resolve(args.csv);
    const dirInfo = await stat(dir).catch(() => null);
    if (!dirInfo?.isDirectory()) {
      console.error("[import:resumes] --dir is not a folder.");
      return 1;
    }
    const csvInfo = await stat(csvPath).catch(() => null);
    if (!csvInfo?.isFile()) {
      console.error("[import:resumes] --csv is not a file.");
      return 1;
    }
    if (csvInfo.size > IMPORT_CSV_MAX_BYTES) {
      console.error("[import:resumes] The CSV is larger than 5 MB. Split it into smaller files.");
      return 1;
    }

    const [target] = await prisma.$queryRaw<Array<{ db: string; host: string | null; port: number | null }>>`
      SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;

    const orgs = await prisma.organization.findMany({ select: { id: true, name: true, slug: true } });
    const org = args.org ? orgs.find((o) => o.slug === args.org) : orgs.length === 1 ? orgs[0] : undefined;
    if (!org) {
      console.error(
        args.org
          ? `[import:resumes] No organization with slug "${args.org}".`
          : `[import:resumes] ${orgs.length} organizations exist; pass --org <slug>.`,
      );
      if (orgs.length) console.error(`  Slugs: ${orgs.map((o) => o.slug).join(", ")}`);
      return 1;
    }

    console.log("HireOS resume import");
    console.log(`  Database:     "${target.db}" on ${target.host ?? "local socket"}${target.port ? `:${target.port}` : ""}`);
    console.log(`  Organization: ${org.name} (slug "${org.slug}")`);
    console.log(`  Resume files: ${dir}`);
    console.log(`  Stored into:  ${path.join(getStorageRoot(), "resumes")}`);
    console.log(`  Mode:         ${args.apply ? "APPLY (writes to the database)" : "dry run (writes nothing)"}`);
    console.log("");

    const plan = await planImport({
      prisma,
      organizationId: org.id,
      dir,
      csvText: await readFile(csvPath, "utf8"),
    });

    if (plan.ignoredColumns.length) {
      console.log(`Ignored unknown column(s): ${plan.ignoredColumns.join(", ")}`);
    }
    for (const r of plan.ready) {
      const job = r.job ? ` -> "${r.job.title}" (${r.job.status})` : "";
      console.log(`  row ${r.rowNumber}  ${r.data.file}  READY: ${ACTION_LABEL[r.action]}${job}`);
    }
    for (const s of plan.skipped) {
      console.log(`  row ${s.rowNumber}  ${s.file || "(no file)"}  SKIP: ${s.reasons.join("; ")}`);
    }
    console.log("");
    console.log(`Ready: ${plan.ready.length}   Skipped: ${plan.skipped.length}`);

    if (!args.apply) {
      console.log("Dry run only. Nothing was written. Fix the skipped rows if needed, then re-run with --apply.");
      return 0;
    }
    if (plan.ready.length === 0) {
      console.log("Nothing to import.");
      return 0;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error("[import:resumes] --apply needs an interactive terminal to confirm. Nothing was written.");
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const confirm = await rl.question(`Type the database name "${target.db}" to import ${plan.ready.length} row(s): `);
    rl.close();
    if (confirm.trim() !== target.db) {
      console.error("[import:resumes] Confirmation did not match. Nothing was written.");
      return 1;
    }

    const counts = { created: 0, applications: 0, skipped: 0, failed: 0, unparsed: 0, unembedded: 0 };
    for (const row of plan.ready) {
      const label = `  row ${row.rowNumber}  ${row.data.file}`;
      try {
        const result = await importRow({
          prisma,
          organizationId: org.id,
          dir,
          row,
          deps: { extractText: extractResumeText, embed: embedCandidate },
        });
        if (result.status === "CREATED") {
          counts.created += 1;
          if (result.applicationId) counts.applications += 1;
          if (!result.parsed) counts.unparsed += 1;
          if (result.parsed && !result.embedded) counts.unembedded += 1;
          const notes = [
            result.applicationId ? "with application" : "no job",
            result.parsed ? "text extracted" : "TEXT NOT EXTRACTED",
            result.parsed ? (result.embedded ? "search-ready" : "search embedding pending") : null,
          ].filter(Boolean);
          console.log(`${label}  CREATED (${notes.join(", ")})`);
        } else if (result.status === "APPLICATION_ADDED") {
          counts.applications += 1;
          console.log(`${label}  APPLICATION ADDED to existing candidate`);
        } else {
          counts.skipped += 1;
          console.log(`${label}  SKIPPED: ${result.reason}`);
        }
      } catch (err) {
        counts.failed += 1;
        const code = typeof err === "object" && err && "code" in err ? ` (${String((err as { code: unknown }).code)})` : "";
        console.log(`${label}  FAILED${code}; nothing was saved for this row`);
      }
    }

    console.log("");
    console.log(
      `Done. Candidates created: ${counts.created}  Applications created: ${counts.applications}  ` +
        `Skipped: ${counts.skipped}  Failed: ${counts.failed}`,
    );
    if (counts.unparsed) {
      console.log(`${counts.unparsed} resume(s) had no extractable text (e.g. scanned images); open them in the app to review.`);
    }
    if (counts.unembedded) {
      console.log(`${counts.unembedded} candidate(s) are not search-ready yet (Ollama unavailable?). Run: npm run embed:backfill`);
    }
    return counts.failed ? 2 : 0;
  } catch (err) {
    if (err instanceof ImportError) {
      console.error(`[import:resumes] ${err.message} Nothing was written.`);
    } else {
      const code = typeof err === "object" && err && "code" in err ? ` (${String((err as { code: unknown }).code)})` : "";
      console.error(`[import:resumes] Failed${code}.`);
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
