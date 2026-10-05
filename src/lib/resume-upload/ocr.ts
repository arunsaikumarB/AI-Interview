import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Local OCR for scanned / image-only resume PDFs. The work runs in a short-lived
 * child process (scripts/ocr-child.mjs) so a native crash, hang or memory spike
 * cannot take down the web server or a live interview. Nothing leaves this server.
 * One OCR at a time; the child gets no secrets from this process's environment.
 */

const MAX_PAGES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

type OcrState = { queue: Promise<unknown> };
const g = globalThis as typeof globalThis & { __hireosOcr?: OcrState };
const state: OcrState = (g.__hireosOcr ??= { queue: Promise.resolve() });

function childScript(): string {
  const script = path.join(process.cwd(), "scripts", "ocr-child.mjs");
  if (!existsSync(script)) throw new Error("OCR is not installed");
  return script;
}

/** Only what Node needs to start on Windows/Linux; no DATABASE_URL, AUTH_SECRET, API keys. */
function childEnv(maxPages: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { OCR_MAX_PAGES: String(maxPages), NODE_ENV: process.env.NODE_ENV };
  for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function runChild(buffer: Buffer, maxPages: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=768", childScript()], {
      cwd: process.cwd(),
      env: childEnv(maxPages),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let errText = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Object.assign(new Error("OCR timed out"), { name: "OcrTimeout" }));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_OUTPUT_BYTES) child.kill("SIGKILL");
      else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errText.length < 200) errText += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(Object.assign(new Error("OCR failed"), { name: /^\w{1,40}$/.test(errText.trim()) ? errText.trim() : "OcrFailed" }));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(out).toString("utf8")) as { text?: unknown };
        resolve(typeof parsed.text === "string" ? parsed.text : "");
      } catch (err) {
        reject(err);
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(buffer);
  });
}

/** Text from a PDF's first pages via OCR. Empty string when nothing could be read in time. */
export async function ocrPdfText(buffer: Buffer, opts: { timeoutMs?: number; maxPages?: number } = {}): Promise<string> {
  const run = state.queue.then(async () => {
    try {
      const text = await runChild(buffer, opts.maxPages ?? MAX_PAGES, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return text
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch (err) {
      console.error("[resume-ocr] failed", { name: err instanceof Error ? err.name : typeof err });
      return "";
    }
  });
  state.queue = run.catch(() => undefined);
  return run;
}
