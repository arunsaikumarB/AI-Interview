const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;
/** Old Word files can carry macros, so they are only taken in where staff bring resumes in. */
const STAFF_EXTENSIONS = [...ALLOWED_EXTENSIONS, ".doc"] as const;

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
]);

export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

export function isAllowedResumeFile(
  file: { name: string; type: string },
  opts: { allowDoc?: boolean } = {},
): boolean {
  const name = file.name.toLowerCase();
  const extensions: readonly string[] = opts.allowDoc ? STAFF_EXTENSIONS : ALLOWED_EXTENSIONS;
  const extOk = extensions.some((ext) => name.endsWith(ext));
  const mime = (file.type || "").toLowerCase();
  const mimeOk = !mime || mime === "application/octet-stream" || ALLOWED_MIMES.has(mime);
  return extOk && mimeOk;
}

export function resumeMimeError(): string {
  return "Resume must be PDF, DOCX, or TXT (max 10MB)";
}
