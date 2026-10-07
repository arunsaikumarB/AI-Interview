import { normalizeSkillList } from "@/lib/resume-upload/profile";

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
};

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
}

/** WordPress sends titles and form answers HTML-escaped ("&#8211;", "&amp;", "&lt;1"). */
export function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const n = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return codePoint(n) || whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/** Plain text: tags dropped (line breaks kept), entities decoded, control characters removed. */
export function plainText(raw: string, max: number): string {
  const text = decodeEntities(
    raw
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|li)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[\0-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, max);
}

/** One line of plain text. */
export function oneLine(raw: string, max: number): string {
  return plainText(raw, max * 2).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Years of experience from the form's free text: "5", "5.3 years", "2 years 6 months",
 * "8 months", "<1". Blank, "NA" or anything outside 0–50 gives null.
 */
export function parseExperienceYears(raw: string): number | null {
  const text = oneLine(raw, 100).toLowerCase();
  if (!text) return null;
  if (/^(?:<|less than|below|under)\s*1\b/.test(text)) return 0;
  if (/^(?:fresher|fresh graduate|none|nil|zero)\b/.test(text)) return 0;
  const years = /(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:y|yr|yrs|year|years)\b/.exec(text);
  const months = /(\d{1,3})\s*(?:m|mo|mos|mon|month|months)\b/.exec(text);
  let value: number | null = null;
  if (years) value = Number(years[1]) + (months ? Number(months[1]) / 12 : 0);
  else if (months) value = Number(months[1]) / 12;
  else {
    const bare = /^(\d{1,2}(?:\.\d{1,2})?)\s*\+?$/.exec(text);
    if (bare) value = Number(bare[1]);
  }
  if (value === null || !Number.isFinite(value) || value < 0 || value > 50) return null;
  return Math.round(value * 10) / 10;
}

/** Skills from a comma / semicolon / line separated answer. */
export function parseSkills(raw: string, max = 40): string[] {
  const parts = plainText(raw, 4000)
    .split(/[,;|\n•]+/)
    .map((s) => s.replace(/^[\s\-*]+/, "").trim())
    .filter((s) => s.length > 0 && s.length <= 60);
  return normalizeSkillList(parts).slice(0, max);
}

/** First and last name from the form; falls back to the email's local part. */
export function splitName(raw: string, email: string): { firstName: string; lastName: string } {
  const words = oneLine(raw, 200).split(" ").filter(Boolean);
  const firstName = (words[0] ?? "").slice(0, 100) || email.split("@")[0].slice(0, 100) || "Applicant";
  const lastName = words.slice(1).join(" ").slice(0, 100);
  return { firstName, lastName };
}

const SITE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** True for the careers site's "YYYY-MM-DD HH:MM:SS" (site timezone). */
export function isSiteTime(raw: string): boolean {
  return SITE_TIME.test(raw);
}

/** Shifts a site time by whole minutes, keeping the same format (no timezone conversion). */
export function shiftSiteTime(raw: string, minutes: number): string | null {
  const m = SITE_TIME.exec(raw);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + minutes * 60_000;
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

/** Later of two site times (same format sorts as text). */
export function laterSiteTime(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}
