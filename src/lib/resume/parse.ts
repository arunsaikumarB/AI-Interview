import mammoth from "mammoth";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Local resume text extraction — PDF + DOCX + plain text.
 * No cloud document APIs.
 *
 * pdf-parse (pdfjs) expects browser DOM globals. Docker Node has none, so we
 * install minimal polyfills BEFORE dynamically importing pdf-parse.
 * Standalone Docker images omit pdf.worker.mjs unless we setWorker + copy deps.
 */

function ensurePdfDomPolyfills(): void {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.DOMMatrix === "undefined") {
    // Minimal stub — pdfjs only checks existence at module init for text extract.
    g.DOMMatrix = class DOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      constructor() {}
      multiplySelf() {
        return this;
      }
      prependSelf() {
        return this;
      }
      invertSelf() {
        return this;
      }
      translateSelf() {
        return this;
      }
      scaleSelf() {
        return this;
      }
      rotateSelf() {
        return this;
      }
    };
  }

  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(
        dataOrWidth: Uint8ClampedArray | number,
        widthOrHeight?: number,
        height?: number,
      ) {
        if (typeof dataOrWidth === "number") {
          this.width = dataOrWidth;
          this.height = widthOrHeight ?? 0;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        } else {
          this.data = dataOrWidth;
          this.width = widthOrHeight ?? 0;
          this.height = height ?? 0;
        }
      }
    };
  }

  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {
      constructor() {}
    };
  }
}

function resolvePdfWorkerSrc(): string | undefined {
  const candidates = [
    path.join(
      process.cwd(),
      "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs",
    ),
    path.join(
      process.cwd(),
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ),
  ];
  return candidates.find((p) => existsSync(p));
}

export async function extractResumeText(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const mime = params.mimeType.toLowerCase();
  const name = params.fileName.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    ensurePdfDomPolyfills();
    // Dynamic import so GET routes / module graphs never load pdfjs unless needed.
    const { PDFParse } = await import("pdf-parse");
    const workerSrc = resolvePdfWorkerSrc();
    if (workerSrc) {
      PDFParse.setWorker(workerSrc);
    }
    const parser = new PDFParse({ data: params.buffer });
    try {
      const result = await parser.getText();
      const text = cleanText(result.text ?? "");
      if (!text) {
        throw new Error("Could not extract text from this PDF");
      }
      return text;
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer: params.buffer });
    return cleanText(result.value ?? "");
  }

  if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return cleanText(params.buffer.toString("utf8"));
  }

  throw new Error("Unsupported resume format. Upload PDF, DOCX, or plain text.");
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
