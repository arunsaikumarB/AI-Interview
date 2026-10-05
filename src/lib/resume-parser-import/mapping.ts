import { z } from "zod";
import { IMPORT_ERROR_LIST_LIMIT } from "./constants";

/** HireOS fields a Resume Parser export column can be mapped onto. HR picks the column for each. */
export const IMPORT_FIELDS = [
  { key: "externalId", label: "Resume Parser ID", hint: "Unique ID of the application in Resume Parser. Recommended: prevents duplicates on re-upload." },
  { key: "fullName", label: "Full name", hint: "Use this OR First name (+ Last name)." },
  { key: "firstName", label: "First name", hint: "" },
  { key: "lastName", label: "Last name", hint: "" },
  { key: "email", label: "Email", hint: "Required." },
  { key: "phone", label: "Phone", hint: "" },
  { key: "jobRole", label: "Job role applied for", hint: "Required. Matched to an existing job with the same title, otherwise a Closed historical job is created." },
  { key: "experience", label: "Experience (years)", hint: "Numbers like 3, 3.5, \"3 years\", \"3 yrs 6 months\", \"Fresher\". Blank = 0." },
  { key: "appliedAt", label: "Application date", hint: "Blank = date of import." },
  { key: "resumeReference", label: "Resume file name / link", hint: "Stored as a text reference only; the file itself is not imported." },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
const FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key) as [ImportFieldKey, ...ImportFieldKey[]];

export const DATE_FORMATS = ["DMY", "MDY", "YMD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export type ColumnMap = Partial<Record<ImportFieldKey, number>>;

export const mappingSchema = z.object({
  columns: z.partialRecord(z.enum(FIELD_KEYS), z.number().int().min(0).max(1000)),
  dateFormat: z.enum(DATE_FORMATS).default("DMY"),
});
export type ImportMapping = z.output<typeof mappingSchema>;

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Pre-fills the column pickers from heading names. Only a suggestion; HR confirms every field. */
export function suggestMapping(header: string[]): ColumnMap {
  const keys = header.map(headerKey);
  const used = new Set<number>();
  const out: ColumnMap = {};
  const pick = (field: ImportFieldKey, test: (k: string) => boolean) => {
    const i = keys.findIndex((k, idx) => k !== "" && !used.has(idx) && test(k));
    if (i >= 0) {
      out[field] = i;
      used.add(i);
    }
  };
  pick("email", (k) => k.includes("email") || k === "mail");
  pick("firstName", (k) => k === "firstname" || k === "fname" || k === "givenname");
  pick("lastName", (k) => k === "lastname" || k === "lname" || k === "surname" || k === "familyname");
  if (out.firstName === undefined) {
    pick("fullName", (k) => ["name", "fullname", "candidatename", "applicantname", "candidate"].includes(k));
  }
  pick("phone", (k) => k.includes("phone") || k.includes("mobile") || k === "contact" || k === "contactnumber");
  pick("jobRole", (k) =>
    ["jobrole", "role", "appliedrole", "position", "appliedposition", "designation", "jobtitle", "appliedfor", "job", "jobapplied"].includes(k),
  );
  pick("experience", (k) => k.includes("experience") || k === "exp" || k === "totalexp" || k === "yearsofexperience");
  pick("appliedAt", (k) => k.includes("date") || k === "appliedon" || k === "applied" || k === "createdat");
  pick("externalId", (k) =>
    ["id", "candidateid", "applicationid", "resumeid", "applicantid", "parserid", "resumeparserid", "recordid"].includes(k),
  );
  pick("resumeReference", (k) => k.includes("resume") || k.includes("cv"));
  return out;
}

/** Problems with HR's column choices. Empty array = usable mapping. */
export function validateMapping(columns: ColumnMap, header: string[]): string[] {
  const problems: string[] = [];
  const label = (k: ImportFieldKey) => IMPORT_FIELDS.find((f) => f.key === k)?.label ?? k;
  const byIndex = new Map<number, ImportFieldKey>();
  for (const [field, idx] of Object.entries(columns) as [ImportFieldKey, number][]) {
    if (idx >= header.length) {
      problems.push(`${label(field)}: the chosen column does not exist in this file.`);
      continue;
    }
    const other = byIndex.get(idx);
    if (other) problems.push(`The column "${header[idx]}" is chosen for both ${label(other)} and ${label(field)}.`);
    byIndex.set(idx, field);
  }
  if (columns.email === undefined) problems.push("Choose the column that holds the Email.");
  if (columns.jobRole === undefined) problems.push("Choose the column that holds the Job role applied for.");
  if (columns.fullName === undefined && columns.firstName === undefined) {
    problems.push("Choose the column for Full name, or for First name.");
  }
  if (columns.fullName !== undefined && (columns.firstName !== undefined || columns.lastName !== undefined)) {
    problems.push("Choose either Full name, or First name + Last name, not both.");
  }
  return problems;
}

const MAX_EXPERIENCE_YEARS = 60;

/** Years of experience. Blank / "Fresher" = 0. "3+" counts as 3. Ranges like "2-4" are rejected. */
export function parseExperience(raw: string): { ok: true; years: number; blank: boolean } | { ok: false } {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (s === "") return { ok: true, years: 0, blank: true };
  if (/^(fresher|fresh|freshers|nil|none|no experience)$/.test(s)) return { ok: true, years: 0, blank: false };

  let years: number | null = null;
  const plain = /^(\d+(?:\.\d+)?)\s*\+?$/.exec(s);
  if (plain) {
    years = Number(plain[1]);
  } else {
    const ym = /^(?:(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?|y)\.?)?\s*(?:(\d+)\s*(?:months?|mons?|mos?|m)\.?)?$/.exec(s);
    if (ym && (ym[1] !== undefined || ym[2] !== undefined)) {
      const months = ym[2] !== undefined ? Number(ym[2]) : 0;
      if (months > 1200) return { ok: false };
      years = (ym[1] !== undefined ? Number(ym[1]) : 0) + months / 12;
    }
  }
  if (years === null || !Number.isFinite(years) || years < 0 || years > MAX_EXPERIENCE_YEARS) return { ok: false };
  return { ok: true, years: Math.round(years * 100) / 100, blank: false };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthFromName = (name: string) => {
  const n = name.toLowerCase();
  if (n.length < 3) return 0;
  const i = MONTHS.findIndex((m) => n.startsWith(m));
  return i >= 0 ? i + 1 : 0;
};

const EARLIEST_YEAR = 1990;

/**
 * Application date. Returns null for blank. Numeric dates follow the chosen order
 * (DD/MM/YYYY by default); YYYY-MM-DD and month names are always accepted.
 * Stored at 12:00 UTC so the calendar date is the same in IST and UTC.
 */
export function parseApplicationDate(
  raw: string,
  format: DateFormat,
  now: Date,
): { ok: true; date: Date | null } | { ok: false; reason: "invalid" | "future" } {
  let s = raw.trim();
  if (s === "") return { ok: true, date: null };
  s = s.replace(/(?:[T\s]+)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:am|pm)?\s*(?:z|[+-]\d{2}:?\d{2})?$/i, "").trim();

  let y = 0;
  let m = 0;
  let d = 0;
  const numeric = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/.exec(s);
  const dayMonthName = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([a-z]{3,9})\.?[\s\-/,]+(\d{4})$/i.exec(s);
  const monthNameDay = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
  if (numeric) {
    const [a, b, c] = [numeric[1], numeric[2], numeric[3]];
    if (a.length === 4) {
      [y, m, d] = [Number(a), Number(b), Number(c)];
    } else if (c.length === 4 && format !== "YMD") {
      [d, m] = format === "DMY" ? [Number(a), Number(b)] : [Number(b), Number(a)];
      y = Number(c);
    } else {
      return { ok: false, reason: "invalid" };
    }
  } else if (dayMonthName) {
    [d, m, y] = [Number(dayMonthName[1]), monthFromName(dayMonthName[2]), Number(dayMonthName[3])];
  } else if (monthNameDay) {
    [m, d, y] = [monthFromName(monthNameDay[1]), Number(monthNameDay[2]), Number(monthNameDay[3])];
  } else {
    return { ok: false, reason: "invalid" };
  }

  if (y < EARLIEST_YEAR || m < 1 || m > 12 || d < 1) return { ok: false, reason: "invalid" };
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return { ok: false, reason: "invalid" };
  if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return { ok: false, reason: "future" };
  return { ok: true, date };
}

/** Lowercased, single-spaced title used to match a role to a job. */
export function roleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export type ImportRow = {
  rowNumber: number;
  externalId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  jobRole: string;
  roleKey: string;
  experience: number;
  appliedAt: Date | null;
  resumeReference: string | null;
};

export type RowError = { rowNumber: number; reasons: string[] };

export type NormalizedImport = {
  totalRows: number;
  rows: ImportRow[];
  errorCount: number;
  errors: RowError[];
  duplicatesInFile: number;
  missingDates: number;
  blankExperience: number;
  unmappedColumns: string[];
};

const emailSchema = z.string().email().max(200);
const DATE_LABEL: Record<DateFormat, string> = { DMY: "DD/MM/YYYY", MDY: "MM/DD/YYYY", YMD: "YYYY-MM-DD" };

/**
 * Validates every row against HR's mapping. Invalid rows are reported (row number and reason,
 * never the candidate's email or name) and left out; duplicates inside the file keep the first row.
 * Row numbers count the heading row as row 1.
 */
export function normalizeRows(header: string[], rows: string[][], mapping: ImportMapping, now: Date): NormalizedImport {
  const cols = mapping.columns as ColumnMap;
  const mappedIdx = new Set(Object.values(cols));
  const unmappedColumns = header.filter((h, i) => h !== "" && !mappedIdx.has(i));

  const out: ImportRow[] = [];
  const errors: RowError[] = [];
  let errorCount = 0;
  let duplicatesInFile = 0;
  let missingDates = 0;
  let blankExperience = 0;
  const seenExternal = new Set<string>();
  const seenEmailRole = new Set<string>();

  rows.forEach((cells, i) => {
    const rowNumber = i + 2;
    const get = (field: ImportFieldKey) => {
      const idx = cols[field];
      return idx === undefined ? "" : (cells[idx] ?? "").trim();
    };
    const reasons: string[] = [];

    if (cells.length > header.length && cells.slice(header.length).some((c) => c.trim() !== "")) {
      reasons.push("has more values than there are column headings (check for unquoted commas)");
    }

    const email = get("email").toLowerCase();
    if (!email) reasons.push("email is empty");
    else if (!emailSchema.safeParse(email).success) reasons.push("email is not a valid address");

    let firstName = "";
    let lastName = "";
    if (cols.fullName !== undefined) {
      const parts = get("fullName").split(/\s+/).filter(Boolean);
      firstName = parts[0] ?? "";
      lastName = parts.slice(1).join(" ");
    } else {
      firstName = get("firstName").replace(/\s+/g, " ");
      lastName = get("lastName").replace(/\s+/g, " ");
    }
    if (!firstName) reasons.push("name is empty");
    else if (firstName.length > 80 || lastName.length > 80) reasons.push("name is longer than 80 characters");

    const jobRole = get("jobRole").replace(/\s+/g, " ");
    if (!jobRole) reasons.push("job role is empty");
    else if (jobRole.length > 200) reasons.push("job role is longer than 200 characters");

    const phone = get("phone");
    if (phone.length > 40) reasons.push("phone is longer than 40 characters");

    const externalId = get("externalId");
    if (externalId.length > 100) reasons.push("Resume Parser ID is longer than 100 characters");

    const resumeReference = get("resumeReference");
    if (resumeReference.length > 500) reasons.push("resume reference is longer than 500 characters");

    const expRaw = get("experience");
    const exp = parseExperience(expRaw);
    if (!exp.ok) reasons.push(`experience "${expRaw.slice(0, 30)}" is not a number of years between 0 and ${MAX_EXPERIENCE_YEARS}`);

    const dateRaw = get("appliedAt");
    const date = parseApplicationDate(dateRaw, mapping.dateFormat, now);
    if (!date.ok) {
      reasons.push(
        date.reason === "future"
          ? `application date "${dateRaw.slice(0, 30)}" is in the future`
          : `application date "${dateRaw.slice(0, 30)}" is not a valid ${DATE_LABEL[mapping.dateFormat]} date`,
      );
    }

    if (reasons.length > 0) {
      errorCount++;
      if (errors.length < IMPORT_ERROR_LIST_LIMIT) errors.push({ rowNumber, reasons });
      return;
    }

    const key = roleKey(jobRole);
    const emailRole = `${email}|${key}`;
    if ((externalId && seenExternal.has(externalId)) || seenEmailRole.has(emailRole)) {
      duplicatesInFile++;
      return;
    }
    if (externalId) seenExternal.add(externalId);
    seenEmailRole.add(emailRole);

    const appliedAt = date.ok ? date.date : null;
    if (!appliedAt) missingDates++;
    if (exp.ok && exp.blank) blankExperience++;
    out.push({
      rowNumber,
      externalId: externalId || null,
      email,
      firstName,
      lastName,
      phone: phone || null,
      jobRole,
      roleKey: key,
      experience: exp.ok ? exp.years : 0,
      appliedAt,
      resumeReference: resumeReference || null,
    });
  });

  return {
    totalRows: rows.length,
    rows: out,
    errorCount,
    errors,
    duplicatesInFile,
    missingDates,
    blankExperience,
    unmappedColumns,
  };
}
