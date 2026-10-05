import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ImportFileError, readCsvTable } from "../../src/lib/resume-parser-import/file";
import {
  mappingSchema,
  normalizeRows,
  parseApplicationDate,
  parseExperience,
  suggestMapping,
  validateMapping,
  type ImportMapping,
} from "../../src/lib/resume-parser-import/mapping";
import { IMPORT_MAX_ROWS } from "../../src/lib/resume-parser-import/constants";
import { resumeKey } from "../../src/lib/resume-parser-import/resumes";

const enc = (s: string) => new TextEncoder().encode(s);
const NOW = new Date(Date.UTC(2026, 9, 2, 12));

function fileError(fn: () => unknown, pattern: RegExp) {
  assert.throws(fn, (err: unknown) => err instanceof ImportFileError && pattern.test(err.message));
}

describe("resumeKey", () => {
  it("reduces a resume reference to its lowercased file name", () => {
    assert.equal(resumeKey("Ravi.PDF"), "ravi.pdf");
    assert.equal(resumeKey("  C:\\resumes\\2025\\Ravi Kumar.pdf "), "ravi kumar.pdf");
    assert.equal(resumeKey("/data/cv/ravi.pdf"), "ravi.pdf");
    assert.equal(resumeKey("https://rp.local/files/ravi.pdf?token=abc#page=2"), "ravi.pdf");
    assert.equal(resumeKey(""), "");
  });
});

describe("readCsvTable", () => {
  it("rejects an empty file", () => {
    fileError(() => readCsvTable(new Uint8Array()), /empty/);
    fileError(() => readCsvTable(enc("\n\n  \n")), /empty/);
  });

  it("rejects binary and non-UTF-8 files", () => {
    fileError(() => readCsvTable(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])), /not a CSV/);
    fileError(() => readCsvTable(new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x2c, 0x4a, 0x6f, 0x73, 0xe9])), /not UTF-8/);
  });

  it("rejects headings without rows, single-column files, repeated headings and broken quotes", () => {
    fileError(() => readCsvTable(enc("Name,Email\n")), /no rows/);
    fileError(() => readCsvTable(enc("Name;Email;Role\nA;a@x.com;Dev\n")), /column headings/);
    fileError(() => readCsvTable(enc("Email,Name,email\na,b,c\n")), /appears more than once/);
    fileError(() => readCsvTable(enc('Name,Email\n"Ravi,r@x.com\n')), /unclosed quote/);
  });

  it("rejects files over the row limit", () => {
    const body = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `n${i},e${i}@x.com`).join("\n");
    fileError(() => readCsvTable(enc(`Name,Email\n${body}`)), /limit/);
  });

  it("reads a UTF-8 CSV with BOM, CRLF and quoted commas", () => {
    const t = readCsvTable(enc('\uFEFFName,Email,Role\r\n"Kumar, Ravi",r@x.com,Dev\r\n'));
    assert.deepEqual(t.header, ["Name", "Email", "Role"]);
    assert.deepEqual(t.rows, [["Kumar, Ravi", "r@x.com", "Dev"]]);
  });
});

describe("column mapping", () => {
  const header = ["Applicant ID", "Candidate Name", "Email Address", "Mobile", "Applied Role", "Total Experience", "Applied Date", "Resume File", "Notes"];

  it("suggests columns from headings, each column used once", () => {
    assert.deepEqual(suggestMapping(header), {
      externalId: 0,
      fullName: 1,
      email: 2,
      phone: 3,
      jobRole: 4,
      experience: 5,
      appliedAt: 6,
      resumeReference: 7,
    });
    assert.deepEqual(suggestMapping(["First Name", "Last Name", "E-mail", "Position"]), {
      firstName: 0,
      lastName: 1,
      email: 2,
      jobRole: 3,
    });
  });

  it("only accepts known fields and non-negative column numbers from the browser", () => {
    assert.equal(mappingSchema.safeParse({ columns: { email: 1, jobRole: 2, fullName: 0 } }).success, true);
    assert.equal(mappingSchema.safeParse({ columns: { organizationId: 1 } }).success, false);
    assert.equal(mappingSchema.safeParse({ columns: { email: -1 } }).success, false);
    assert.equal(mappingSchema.safeParse({ columns: { email: "../etc" } }).success, false);
    assert.equal(mappingSchema.safeParse({ columns: {}, dateFormat: "XYZ" }).success, false);
  });

  it("requires email, job role and a name column", () => {
    const problems = validateMapping({}, header);
    assert.equal(problems.length, 3);
    assert.ok(problems.some((p) => /Email/.test(p)));
    assert.ok(problems.some((p) => /Job role/.test(p)));
    assert.ok(problems.some((p) => /Full name/.test(p)));
  });

  it("rejects a column used twice, a missing column and mixing name styles", () => {
    assert.ok(validateMapping({ email: 2, jobRole: 2, fullName: 1 }, header).some((p) => /both/.test(p)));
    assert.ok(validateMapping({ email: 99, jobRole: 4, fullName: 1 }, header).some((p) => /does not exist/.test(p)));
    assert.ok(validateMapping({ email: 2, jobRole: 4, fullName: 1, firstName: 0 }, header).some((p) => /not both/.test(p)));
    assert.deepEqual(validateMapping({ email: 2, jobRole: 4, firstName: 1 }, header), []);
  });
});

describe("parseExperience", () => {
  const years = (s: string) => {
    const r = parseExperience(s);
    return r.ok ? r.years : "invalid";
  };
  it("accepts numbers, years/months text and fresher", () => {
    assert.equal(years("3"), 3);
    assert.equal(years("3.5"), 3.5);
    assert.equal(years("3 years"), 3);
    assert.equal(years("3.5 Yrs"), 3.5);
    assert.equal(years("3 yrs 6 months"), 3.5);
    assert.equal(years("6 months"), 0.5);
    assert.equal(years("2+"), 2);
    assert.equal(years("2+ years"), 2);
    assert.equal(years("Fresher"), 0);
    assert.equal(years(""), 0);
    assert.deepEqual(parseExperience(" "), { ok: true, years: 0, blank: true });
  });
  it("rejects ranges, words, negatives and impossible values", () => {
    for (const s of ["2-4", "2 to 4", "senior", "-1", "61", "abc years", "3,5"]) {
      assert.equal(years(s), "invalid", s);
    }
  });
});

describe("parseApplicationDate", () => {
  const iso = (s: string, f: "DMY" | "MDY" | "YMD" = "DMY") => {
    const r = parseApplicationDate(s, f, NOW);
    return r.ok ? r.date?.toISOString().slice(0, 10) ?? null : r.reason;
  };
  it("reads the chosen numeric order plus ISO and month names", () => {
    assert.equal(iso("15/03/2025"), "2025-03-15");
    assert.equal(iso("15-03-2025"), "2025-03-15");
    assert.equal(iso("15.03.2025"), "2025-03-15");
    assert.equal(iso("03/15/2025", "MDY"), "2025-03-15");
    assert.equal(iso("2025-03-15"), "2025-03-15");
    assert.equal(iso("2025-03-15 10:20:00"), "2025-03-15");
    assert.equal(iso("2025-03-15T10:20:00Z"), "2025-03-15");
    assert.equal(iso("15/03/2025 4:05 PM"), "2025-03-15");
    assert.equal(iso("15 Mar 2025"), "2025-03-15");
    assert.equal(iso("15-March-2025"), "2025-03-15");
    assert.equal(iso("Mar 15, 2025"), "2025-03-15");
    assert.equal(iso(""), null);
  });
  it("stores the date at 12:00 UTC", () => {
    const r = parseApplicationDate("01/01/2025", "DMY", NOW);
    assert.ok(r.ok && r.date);
    assert.equal(r.date.toISOString(), "2025-01-01T12:00:00.000Z");
  });
  it("rejects impossible, ambiguous, too-old and future dates", () => {
    assert.equal(iso("31/02/2025"), "invalid");
    assert.equal(iso("03/15/2025"), "invalid");
    assert.equal(iso("2025/13/01"), "invalid");
    assert.equal(iso("12/03/25"), "invalid");
    assert.equal(iso("15/03/2025", "YMD"), "invalid");
    assert.equal(iso("01/01/1989"), "invalid");
    assert.equal(iso("yesterday"), "invalid");
    assert.equal(iso("Foo 15, 2025"), "invalid");
    assert.equal(iso("01/01/2027"), "future");
  });
});

describe("normalizeRows", () => {
  const header = ["ID", "Name", "Email", "Role", "Exp", "Date", "Resume", "Extra"];
  const mapping: ImportMapping = {
    columns: { externalId: 0, fullName: 1, email: 2, jobRole: 3, experience: 4, appliedAt: 5, resumeReference: 6 },
    dateFormat: "DMY",
  };

  it("normalizes valid rows and reports unmapped columns", () => {
    const r = normalizeRows(header, [["RP-1", "  Ravi  Kumar Reddy ", "Ravi@Example.COM", " Java  Developer ", "3 yrs", "15/03/2025", "ravi.pdf", "x"]], mapping, NOW);
    assert.equal(r.errorCount, 0);
    assert.deepEqual(r.unmappedColumns, ["Extra"]);
    assert.deepEqual(r.rows[0], {
      rowNumber: 2,
      externalId: "RP-1",
      email: "ravi@example.com",
      firstName: "Ravi",
      lastName: "Kumar Reddy",
      phone: null,
      jobRole: "Java Developer",
      roleKey: "java developer",
      experience: 3,
      appliedAt: new Date(Date.UTC(2025, 2, 15, 12)),
      resumeReference: "ravi.pdf",
    });
  });

  it("reports invalid rows with row numbers and without personal data", () => {
    const r = normalizeRows(
      header,
      [
        ["1", "", "secret.person@example.com", "", "", "", "", ""],
        ["2", "Asha", "not-an-email", "Dev", "2-4", "31/02/2025", "", ""],
        ["3", "Asha", "asha@example.com", "Dev", "", "", "", "", "unexpected"],
        ["4", "Ok", "ok@example.com", "Dev", "", "", "", ""],
      ],
      mapping,
      NOW,
    );
    assert.equal(r.errorCount, 3);
    assert.equal(r.rows.length, 1);
    assert.deepEqual(r.errors.map((e) => e.rowNumber), [2, 3, 4]);
    assert.deepEqual(r.errors[0].reasons, ["name is empty", "job role is empty"]);
    assert.ok(r.errors[1].reasons.includes("email is not a valid address"));
    assert.ok(r.errors[1].reasons.some((x) => x.startsWith('experience "2-4"')));
    assert.ok(r.errors[1].reasons.some((x) => x.startsWith('application date "31/02/2025"')));
    assert.ok(r.errors[2].reasons[0].includes("more values"));
    assert.ok(!JSON.stringify(r.errors).includes("secret.person"));
    assert.equal(r.missingDates, 1);
    assert.equal(r.blankExperience, 1);
  });

  it("counts duplicates inside the file by Resume Parser ID and by email + role", () => {
    const r = normalizeRows(
      header,
      [
        ["A", "Ravi", "ravi@x.com", "Java Developer", "", "", "", ""],
        ["A", "Ravi", "ravi2@x.com", "Tester", "", "", "", ""],
        ["B", "Ravi", "RAVI@x.com", "java  developer", "", "", "", ""],
        ["C", "Ravi", "ravi@x.com", "Tester", "", "", "", ""],
      ],
      mapping,
      NOW,
    );
    assert.equal(r.duplicatesInFile, 2);
    assert.deepEqual(r.rows.map((x) => x.externalId), ["A", "C"]);
  });

  it("caps the error list but keeps the full error count", () => {
    const rows = Array.from({ length: 250 }, (_, i) => [String(i), "N", "bad", "Dev", "", "", "", ""]);
    const r = normalizeRows(header, rows, mapping, NOW);
    assert.equal(r.errorCount, 250);
    assert.equal(r.errors.length, 200);
  });
});
