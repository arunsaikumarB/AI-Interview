/**
 * One-time creation of the first Organization + SUPER_ADMIN on a FRESH database.
 * Operator action only. See docs/DEPLOYMENT-BOOTSTRAP-ADMIN.md.
 *
 *   npm run bootstrap:admin
 *
 * Interactive only (refuses piped input so passwords never pass through shell
 * history, environment variables or files). Never prints the password.
 */
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";
import {
  alreadyBootstrappedReasons,
  bootstrapAdmin,
  BootstrapError,
  passwordProblems,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  readBootstrapState,
  validateBootstrapInput,
} from "../src/lib/bootstrap-admin";

class Cancelled extends Error {}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let chars: string[] = [];
    const finish = (err?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      if (err) reject(err);
      else resolve(chars.join(""));
      chars = [];
    };
    const onData = (chunk: string) => {
      for (const ch of Array.from(chunk)) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003" || ch === "\u0004") return finish(new Cancelled());
        if (ch === "\u007f" || ch === "\b") chars.pop();
        else if (ch >= " ") chars.push(ch);
      }
    };
    stdin.on("data", onData);
  });
}

async function main(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("[bootstrap:admin] Refusing to run: an interactive terminal is required (no piped input).");
    return 1;
  }

  const prisma = new PrismaClient();
  try {
    const [target] = await prisma.$queryRaw<Array<{ db: string; host: string | null; port: number | null }>>`
      SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`;
    console.log("HireOS first-admin bootstrap (one-time operator action)");
    console.log(`Target database: "${target.db}" on ${target.host ?? "local socket"}${target.port ? `:${target.port}` : ""}`);

    const reasons = alreadyBootstrappedReasons(await readBootstrapState(prisma));
    if (reasons.length) {
      console.error("[bootstrap:admin] Refused: this database is not fresh.");
      for (const r of reasons) console.error(`  - ${r}`);
      console.error("[bootstrap:admin] Nothing was created or changed.");
      return 1;
    }

    const organizationName = await ask("Organization name: ");
    const adminName = await ask("Admin full name: ");
    const adminEmail = await ask("Admin email: ");
    console.log(
      `Password: at least ${PASSWORD_MIN_LENGTH} characters (max ${PASSWORD_MAX_BYTES} bytes), with upper- and lowercase letters, a digit and a symbol.`,
    );
    const password = await askHidden("Admin password (hidden): ");
    const problems = passwordProblems(password, { adminEmail: adminEmail.trim().toLowerCase() });
    if (problems.length) throw new BootstrapError("WEAK_PASSWORD", "Password does not meet the requirements.", problems);
    const passwordConfirmation = await askHidden("Confirm password (hidden): ");
    const input = { organizationName, adminName, adminEmail, password, passwordConfirmation };
    const valid = validateBootstrapInput(input);

    console.log("");
    console.log("About to create exactly:");
    console.log(`  Organization: ${valid.organizationName} (slug "${valid.organizationSlug}")`);
    console.log(`  SUPER_ADMIN:  ${valid.adminName} <${valid.adminEmail}>`);
    const confirm = await ask(`Type the database name "${target.db}" to confirm: `);
    if (confirm.trim() !== target.db) {
      console.error("[bootstrap:admin] Confirmation did not match. Nothing was created.");
      return 1;
    }

    const result = await bootstrapAdmin(prisma, input);
    console.log("");
    console.log("[bootstrap:admin] Created:");
    console.log(`  Organization ${result.organization.id}  "${result.organization.name}"  slug=${result.organization.slug}`);
    console.log(`  User         ${result.admin.id}  ${result.admin.email}  role=SUPER_ADMIN`);
    console.log(`  At           ${result.admin.createdAt.toISOString()}`);
    console.log("[bootstrap:admin] Sign in at /login with this email. Keep this output as the bootstrap record.");
    return 0;
  } catch (err) {
    if (err instanceof Cancelled) {
      console.error("[bootstrap:admin] Cancelled. Nothing was created.");
    } else if (err instanceof BootstrapError) {
      console.error(`[bootstrap:admin] ${err.message}`);
      for (const d of err.details) console.error(`  - ${d}`);
      console.error("[bootstrap:admin] Nothing was created or changed.");
    } else {
      const code = typeof err === "object" && err && "code" in err ? ` (${String((err as { code: unknown }).code)})` : "";
      console.error(`[bootstrap:admin] Failed${code}. The organization and admin are created in one transaction, so nothing was created.`);
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
