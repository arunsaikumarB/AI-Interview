/**
 * OCR for one PDF, run as a short-lived child process by src/lib/resume-upload/ocr.ts
 * so a native crash (canvas/Skia) or runaway memory cannot take down the web server.
 *
 * stdin: the PDF bytes. stdout: {"text": "..."}. Exit code 1 on failure (error name on stderr).
 * Everything is local: pdf.js renders pages with @napi-rs/canvas, Tesseract (WASM) reads them
 * with the English data installed in node_modules. No network.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.join(here, "..", "node_modules");
const maxPages = Math.min(Math.max(Number(process.env.OCR_MAX_PAGES) || 3, 1), 5);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

async function renderPages(pdf) {
  const canvas = await import("@napi-rs/canvas");
  Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, ImageData: canvas.ImageData, Path2D: canvas.Path2D });
  const { PDFParse } = await import("pdf-parse");
  const worker = path.join(modules, "pdfjs-dist/legacy/build/pdf.worker.mjs");
  if (existsSync(worker)) PDFParse.setWorker(pathToFileURL(worker).href);
  const parser = new PDFParse({ data: pdf });
  try {
    const shots = await parser.getScreenshot({ scale: 2, first: maxPages, imageBuffer: true, imageDataUrl: false });
    return shots.pages.flatMap((p) => (p.data ? [Buffer.from(p.data)] : []));
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function recognize(pages) {
  const langPath = path.join(modules, "@tesseract.js-data/eng/4.0.0_best_int");
  if (!existsSync(path.join(langPath, "eng.traineddata.gz"))) throw new Error("OCR language data is not installed");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    langPath,
    cachePath: path.join(os.tmpdir(), "hireos-ocr"),
    cacheMethod: "none",
    gzip: true,
  });
  try {
    const texts = [];
    for (const page of pages) {
      const { data } = await worker.recognize(page);
      texts.push(data.text ?? "");
    }
    return texts.join("\n\n");
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

try {
  const pdf = await readStdin();
  const text = await recognize(await renderPages(pdf));
  process.stdout.write(JSON.stringify({ text }), () => process.exit(0));
} catch (err) {
  process.stderr.write(err instanceof Error ? err.name : "Error");
  process.exit(1);
}
