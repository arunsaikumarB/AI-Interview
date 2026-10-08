/**
 * pdf-parse writes a "-- 1 of 2 --" line between pages. It is reader output, not resume content:
 * it must not be stored, counted as parsed text, or returned by an API.
 */
const PAGE_MARKER_LINE = /^[ \t]*--[ \t]*\d+[ \t]+of[ \t]+\d+[ \t]*--[ \t]*$/gm;

export function stripPageMarkers(text: string): string {
  return text.replace(/\0/g, "").replace(PAGE_MARKER_LINE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** For stored text that predates extraction-time stripping. */
export function publicResumeText(text: string | null): string | null {
  if (text === null) return null;
  return stripPageMarkers(text) || null;
}
