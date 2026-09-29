import crypto from "node:crypto";
import { EVALUATION_RETRY_DELAY_MS, MAX_EVALUATION_ATTEMPTS } from "@/lib/ai/evaluation-status";

/**
 * Signed client for the local sandbox runner (sandbox-runner/runner.py).
 * Next.js never launches containers or connects to the SQL sandbox itself.
 */

export type RunnerFailure = "UNAVAILABLE" | "BUSY" | "REJECTED" | "BAD_RESPONSE";
export type RunnerCallResult<T> = { ok: true; data: T } | { ok: false; error: RunnerFailure };

export type RunnerConfig = { url: string; secret: string };

export function runnerConfig(): RunnerConfig | null {
  const url = process.env.SANDBOX_RUNNER_URL ?? "http://127.0.0.1:8010";
  const secret = process.env.SANDBOX_RUNNER_SECRET ?? "";
  if (secret.length < 32) return null;
  return { url: url.replace(/\/+$/, ""), secret };
}

export function signRunnerRequest(secret: string, ts: string, method: string, path: string, body: string): string {
  const bodyHash = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  return crypto.createHmac("sha256", secret).update(`${ts}.${method}.${path}.${bodyHash}`).digest("hex");
}

export type RunnerFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function callRunner<T>(
  path: "/v1/code/execute" | "/v1/sql/execute",
  payload: unknown,
  opts: { timeoutMs: number; config?: RunnerConfig | null; fetchImpl?: RunnerFetch } ,
): Promise<RunnerCallResult<T>> {
  const config = opts.config === undefined ? runnerConfig() : opts.config;
  if (!config) return { ok: false, error: "UNAVAILABLE" };
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = signRunnerRequest(config.secret, ts, "POST", path, body);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${config.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HireOS-Timestamp": ts,
        "X-HireOS-Signature": signature,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (res.status === 503) return { ok: false, error: "BUSY" };
    if (res.status === 400 || res.status === 401 || res.status === 413) return { ok: false, error: "REJECTED" };
    if (!res.ok) return { ok: false, error: "UNAVAILABLE" };
    const data = (await res.json()) as T;
    if (!data || typeof data !== "object") return { ok: false, error: "BAD_RESPONSE" };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  }
}

/**
 * R-3 bounded retry for the frozen submission: only infrastructure failures
 * (runner down / busy) are retried, at most MAX_EVALUATION_ATTEMPTS times.
 * Candidate-caused outcomes (timeouts, errors) come back as normal responses and are never retried.
 */
export async function callRunnerWithRetry<T>(
  path: "/v1/code/execute" | "/v1/sql/execute",
  payload: unknown,
  opts: { timeoutMs: number; config?: RunnerConfig | null; fetchImpl?: RunnerFetch; sleep?: (ms: number) => Promise<void> },
): Promise<RunnerCallResult<T> & { attempts: number }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: RunnerCallResult<T> = { ok: false, error: "UNAVAILABLE" };
  for (let attempt = 1; attempt <= MAX_EVALUATION_ATTEMPTS; attempt++) {
    last = await callRunner<T>(path, payload, opts);
    if (last.ok || last.error === "REJECTED" || last.error === "BAD_RESPONSE") return { ...last, attempts: attempt };
    if (attempt < MAX_EVALUATION_ATTEMPTS) await sleep(EVALUATION_RETRY_DELAY_MS);
  }
  return { ...last, attempts: MAX_EVALUATION_ATTEMPTS };
}
