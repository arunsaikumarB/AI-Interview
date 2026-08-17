/**
 * CLI wrapper around the existing Next.js extractResumeText (pdf-parse + mammoth).
 * Usage: tsx scripts/extract-resume.mjs <absolute-file> <absolute-output-json>
 *
 * Writes JSON { ok, chars, text } or { ok: false, error_class, error }.
 * Does not print resume text to stdout/stderr.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const filePath = process.argv[2];
const outPath = process.argv[3];

function fail(errorClass, error) {
  return { ok: false, error_class: errorClass, error };
}

async function main() {
  if (!filePath || !outPath) {
    await writeFile(
      outPath || "extract-resume-missing-args.json",
      JSON.stringify(fail("invalid_args", "missing_path")),
    );
    process.exit(2);
  }

  const parseUrl = pathToFileURL(
    path.join(process.cwd(), "src", "lib", "resume", "parse.ts"),
  ).href;
  const { extractResumeText } = await import(parseUrl);

  const fileName = path.basename(filePath);
  const lower = fileName.toLowerCase();
  const mime = lower.endsWith(".pdf")
    ? "application/pdf"
    : lower.endsWith(".docx")
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : lower.endsWith(".txt")
        ? "text/plain"
        : "application/octet-stream";

  const buffer = await readFile(filePath);
  const text = await extractResumeText({ buffer, mimeType: mime, fileName });
  await writeFile(
    outPath,
    JSON.stringify({ ok: true, chars: text.length, text }),
    "utf8",
  );
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : "parser_failure";
  const errorClass = String(message).toLowerCase().includes("unsupported")
    ? "unsupported_file"
    : "parser_failure";
  try {
    if (outPath) {
      await writeFile(outPath, JSON.stringify(fail(errorClass, message)), "utf8");
    }
  } catch {
    // ignore write failures; exit code is the signal
  }
  process.exit(1);
});
