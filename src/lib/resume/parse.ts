import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

/**
 * Local resume text extraction — PDF + DOCX + plain text.
 * No cloud document APIs.
 */
export async function extractResumeText(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const mime = params.mimeType.toLowerCase();
  const name = params.fileName.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: params.buffer });
    try {
      const result = await parser.getText();
      return cleanText(result.text ?? "");
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
