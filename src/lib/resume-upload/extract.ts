/**
 * Best-guess contact details from a resume's text and file name. Every value is a
 * suggestion that HR reviews and corrects before anything is saved.
 */

export type ResumeFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  experience: number | null;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const PHONE_RE = /\+?\d[\d \t().-]{7,18}\d/g;

const NOT_A_NAME =
  /\b(resume|curriculum|vitae|cv|bio-?data|profile|summary|objective|contact|address|e-?mail|phone|mobile|linkedin|github|career|personal|details|experience|education|skills|declaration|projects?|page)\b/i;
const SECTION_HEADING =
  /^(?:professional |career |work |technical )?(?:summary|objective|experienc\w*|education|skills|projects|employment|about me)\b/i;
const ORG_OR_TITLE =
  /\b(solutions?|technolog(?:y|ies)|tech|pvt|ltd|limited|inc|llc|llp|services|systems|software|consult\w*|labs?|infotech|private|corp\w*|company|university|college|school|institute|academy|engineer|developer|designer|manager|analyst|architect|intern|specialist|administrator|tester|executive|recruiter|associate|officer|scientist|devops)\b/i;
const FILE_NOISE = /^(resume|cv|naukri|updated|update|profile|final|new|latest|copy|my|doc|pdf)$/i;

function titleCase(words: string[]): string {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function tidyName(raw: string): string {
  const words = raw.replace(/\s+/g, " ").trim().split(" ");
  const mixed = /[a-z]/.test(raw) && /[A-Z]/.test(raw);
  return mixed ? words.join(" ") : titleCase(words);
}

/** Designed resumes often letter-space the name: "S e e t h a r a m   R e d d y". */
function joinSpacedLetters(line: string): string {
  return line
    .split(/\t| {2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (/^(?:\S ){2,}\S$/.test(chunk) ? chunk.replace(/ /g, "") : chunk))
    .join(" ")
    .replace(/\s+/g, " ");
}

function nameFromText(text: string): string | null {
  const lines = text
    .split("\n")
    .map(joinSpacedLetters)
    .filter(Boolean)
    .slice(0, 15);
  for (const raw of lines) {
    if (SECTION_HEADING.test(raw)) break;
    const line = (raw.replace(/^name\s*[:\-]\s*/i, "").split(/\s[|•·—]\s/)[0] ?? "").trim();
    if (line.length < 3 || line.length > 50) continue;
    if (NOT_A_NAME.test(line) || ORG_OR_TITLE.test(line) || /\bIT\b/.test(line) || /[@\d]/.test(line)) continue;
    if (!/^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F.'\s-]*$/.test(line)) continue;
    const words = line.split(" ");
    if (words.length < 2 || words.length > 4) continue;
    return tidyName(line);
  }
  return null;
}

function nameFromFileName(fileName: string): string | null {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = base
    .split(/[\s_.,-]+/)
    .map((w) => w.replace(/(resume|cv)$/i, ""))
    .filter((w) => w.length > 1 && !FILE_NOISE.test(w) && /^[A-Za-z\u00C0-\u024F]+$/.test(w));
  if (words.length === 0 || words.length > 4) return null;
  return tidyName(words.join(" "));
}

function findEmail(text: string): string {
  for (const m of Array.from(text.matchAll(EMAIL_RE))) {
    const email = m[0].replace(/^[._%+-]+|[._%+-]+$/g, "").toLowerCase();
    if (email.length <= 254) return email;
  }
  return "";
}

function findPhone(text: string): string {
  let fallback = "";
  const withoutEmails = text.replace(EMAIL_RE, " ");
  for (const m of Array.from(withoutEmails.matchAll(PHONE_RE))) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) continue;
    if (/^(19|20)\d{2}\D+(19|20)\d{2}/.test(m[0].trim())) continue;
    const phone = m[0].replace(/\s+/g, " ").trim();
    const indianMobile =
      (digits.length === 10 && /^[6-9]/.test(digits)) ||
      (digits.length === 12 && /^91[6-9]/.test(digits)) ||
      (digits.length === 11 && /^0[6-9]/.test(digits));
    if (indianMobile) return phone;
    if (!fallback) fallback = phone;
  }
  return fallback;
}

function clampExperience(n: number): number | null {
  if (!Number.isFinite(n) || n < 0 || n > 50) return null;
  return Math.round(n * 10) / 10;
}

function findExperience(text: string, fileName: string): number | null {
  const tag = fileName.match(/\[(\d{1,2})y(?:[_\s-]?(\d{1,2})m)?\]/i);
  if (tag) return clampExperience(Number(tag[1]) + Number(tag[2] ?? 0) / 12);

  const flat = text.replace(/\s+/g, " ");
  const before = flat.match(
    /(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and\s*)?(\d{1,2})\s*months?)?\s*(?:of\s+)?(?:[A-Za-z/&-]+\s+){0,3}?experience/i,
  );
  if (before) return clampExperience(Number(before[1]) + Number(before[2] ?? 0) / 12);
  const after = flat.match(/experience\s*(?:of|:|-)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)/i);
  if (after) return clampExperience(Number(after[1]));
  if (/\bfresher\b/i.test(flat)) return 0;
  return null;
}

export function extractResumeFields(text: string, fileName: string): ResumeFields {
  const name = nameFromText(text) ?? nameFromFileName(fileName) ?? "";
  const [first = "", ...rest] = name ? name.split(" ") : [];
  return {
    firstName: first,
    lastName: rest.join(" "),
    email: findEmail(text),
    phone: findPhone(text),
    experience: findExperience(text, fileName),
  };
}
