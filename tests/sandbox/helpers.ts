/**
 * Real-execution helpers for sandbox tests. These talk to the running sandbox
 * runner (npm run sandbox:runner) and the real hireos-sql-sandbox container —
 * nothing here is mocked.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { newRunnerNonce, signRunnerRequest } from "../../src/lib/practical/runner-client";

const ROOT = path.resolve(__dirname, "..", "..");

function parseEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf("=");
    if (!line || line.startsWith("#") || eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export const RUNNER_ENV = parseEnv(path.join(ROOT, "sandbox-runner", ".env"));
export const RUNNER_URL = parseEnv(path.join(ROOT, ".env")).SANDBOX_RUNNER_URL ?? "http://127.0.0.1:8010";
export const RUNNER_SECRET = RUNNER_ENV.SANDBOX_RUNNER_SECRET ?? "";

export async function runnerAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${RUNNER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok && RUNNER_SECRET.length >= 32;
  } catch {
    return false;
  }
}

export async function signedPost(
  pathName: string,
  payload: unknown,
  opts: {
    secret?: string;
    ts?: string;
    nonce?: string;
    /** Nonce placed in the header when it should differ from the signed one. */
    sentNonce?: string;
    omitNonce?: boolean;
    rawBody?: string;
    signature?: string;
  } = {},
): Promise<{ status: number; body: any }> {
  const body = opts.rawBody ?? JSON.stringify(payload);
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? newRunnerNonce();
  const signature = opts.signature ?? signRunnerRequest(opts.secret ?? RUNNER_SECRET, ts, nonce, "POST", pathName, body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-HireOS-Timestamp": ts,
    "X-HireOS-Signature": signature,
  };
  if (!opts.omitNonce) headers["X-HireOS-Nonce"] = opts.sentNonce ?? nonce;
  const res = await fetch(`${RUNNER_URL}${pathName}`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(90_000),
  });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

export const LIMITS = { perTestTimeoutMs: 2000, memoryMb: 256, maxOutputBytes: 65536 };

export async function runCode(language: "python" | "javascript", source: string, inputs: string[] = [""], limits = LIMITS) {
  const tests = inputs.map((input, i) => ({ id: `t${i + 1}`, input }));
  return signedPost("/v1/code/execute", { language, source, tests, limits });
}

export async function runSql(taskKey: string, query: string, limits = { timeoutMs: 3000, maxRows: 500, maxResultBytes: 131072 }) {
  return signedPost("/v1/sql/execute", { taskKey, taskVersion: 1, query, limits });
}

export function sandboxContainers(): string[] {
  const out = execFileSync("docker", ["ps", "-aq", "--filter", "label=hireos.sandbox=1"], { encoding: "utf8" });
  return out.split(/\s+/).filter(Boolean);
}

export function sqlRolePassword(role: string): string {
  return crypto.createHmac("sha256", RUNNER_ENV.SQL_SANDBOX_ROLE_SECRET ?? "").update(role).digest("hex");
}

/**
 * Direct connection to the SQL sandbox as a given role (psql inside the sandbox
 * container, over TCP). Each statement is sent as its own -c, i.e. its own
 * transaction, so a preceding SET really applies to the next statement.
 */
export function psqlAs(role: string, password: string, db: string, sql: string | string[]): { ok: boolean; output: string } {
  const statements = (Array.isArray(sql) ? sql : [sql]).flatMap((s) => ["-c", s]);
  try {
    const output = execFileSync(
      "docker",
      ["exec", "-e", `PGPASSWORD=${password}`, "hireos-sql-sandbox", "psql", "-h", "127.0.0.1", "-U", role, "-d", db, "-v", "ON_ERROR_STOP=1", "-At", ...statements],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: String(err?.stderr ?? err?.message ?? "") };
  }
}

export function taskDb(taskKey: string): { db: string; role: string } {
  const db = `sqltask_${taskKey.replace(/-/g, "_")}_v1`;
  return { db, role: `${db}_ro` };
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
