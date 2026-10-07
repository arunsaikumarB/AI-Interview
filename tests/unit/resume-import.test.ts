import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The module imports @prisma/client, which copies the repo .env into process.env
// for unset keys. Pin DATABASE_URL so this test can never reach a real database.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit_test_unreachable";

import {
  ImportError,
  IMPORT_MAX_ROWS,
  isPlainFileName,
  loadResumeFile,
  parseCsv,
  readManifest,
  resolveJob,
  validateRow,
  type ImportJob,
} from "../../src/lib/resume-import";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, embedded commas/newlines, CRLF and BOM", () => {
    const text = '\uFEFFa,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\nlast,,\n';
    assert.deepEqual(parseCsv(text), [
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["last", "", ""],
    ]);
  });

  it("rejects an unclosed quote", () => {
    assert.throws(() => parseCsv('a,b\n"open,1\n'), ImportError);
  });
});

describe("readManifest", () => {
  it("maps headers case-insensitively and reports unknown columns", () => {
    const { rows, ignoredColumns } = readManifest(
      "File,First Name,last_name,EMAIL,Notes\ncv.pdf,Ravi,K,R@X.COM,hello\n",
    );
    assert.deepEqual(ignoredColumns, ["Notes"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.rowNumber, 2);
    assert.deepEqual(rows[0]!.values, {
      file: "cv.pdf",
      firstName: "Ravi",
      lastName: "K",
      email: "R@X.COM",
    });
  });

  it("requires file, firstName, lastName and email columns", () => {
    assert.throws(() => readManifest("file,firstName,email\n"), /lastName/);
    assert.throws(() => readManifest(""), ImportError);
  });

  it("caps the number of rows per run", () => {
    const body = "a.pdf,A,B,a@x.com\n".repeat(IMPORT_MAX_ROWS + 1);
    assert.throws(() => readManifest(`file,firstName,lastName,email\n${body}`), /limit/);
  });
});

describe("validateRow", () => {
  it("trims, lowercases email and drops empty optionals", () => {
    const r = validateRow({
      file: " cv.pdf ",
      firstName: " Ravi ",
      lastName: "K",
      email: " Ravi@Example.COM ",
      phone: "  ",
      job: "Java Developer",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.email, "ravi@example.com");
      assert.equal(r.data.file, "cv.pdf");
      assert.equal(r.data.phone, undefined);
      assert.equal(r.data.job, "Java Developer");
    }
  });

  it("reports every problem in a bad row", () => {
    const r = validateRow({ file: "", firstName: "", lastName: "K", email: "not-an-email" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.problems.some((p) => p.startsWith("file")));
      assert.ok(r.problems.some((p) => p.startsWith("firstName")));
      assert.ok(r.problems.some((p) => p.startsWith("email")));
    }
  });
});

describe("isPlainFileName", () => {
  it("accepts plain names and rejects any path", () => {
    assert.equal(isPlainFileName("Ravi Kumar CV.pdf"), true);
    for (const bad of ["", ".", "..", "../x.pdf", "a/b.pdf", "a\\b.pdf", "/etc/passwd", "C:\\x.pdf", "x\0.pdf"]) {
      assert.equal(isPlainFileName(bad), false, bad);
    }
  });
});

describe("loadResumeFile", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hireos-import-unit-"));
    await writeFile(path.join(dir, "ok.pdf"), Buffer.from("%PDF-1.4\n%fake but signed\n"));
    await writeFile(path.join(dir, "ok.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
    await writeFile(path.join(dir, "ok.txt"), "Plain text resume");
    await writeFile(path.join(dir, "fake.pdf"), "<html>not a pdf</html>");
    await writeFile(path.join(dir, "fake.doc"), "<html>not a doc</html>");
    await copyFile(path.join(__dirname, "..", "fixtures", "resumes", "resume-plain.doc"), path.join(dir, "ok.doc"));
    await writeFile(path.join(dir, "empty.pdf"), "");
    await writeFile(path.join(dir, "tool.exe"), "MZ");
    await writeFile(path.join(dir, "big.pdf"), Buffer.alloc(10 * 1024 * 1024 + 1, 0x25));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads real PDF, DOCX, DOC and TXT files with the right MIME type", async () => {
    const pdf = await loadResumeFile(dir, "ok.pdf");
    assert.equal(pdf.ok && pdf.resume.mimeType, "application/pdf");
    const docx = await loadResumeFile(dir, "ok.docx");
    assert.equal(docx.ok, true);
    const doc = await loadResumeFile(dir, "ok.doc");
    assert.equal(doc.ok && doc.resume.mimeType, "application/msword");
    const txt = await loadResumeFile(dir, "ok.txt");
    assert.equal(txt.ok && txt.resume.mimeType, "text/plain");
  });

  it("rejects disguised, empty, oversized, wrong-type, missing and path-escaping files", async () => {
    const cases: Array<[string, RegExp]> = [
      ["fake.pdf", /not a real PDF/],
      ["empty.pdf", /empty/],
      ["big.pdf", /larger than 10 MB/],
      ["tool.exe", /PDF, DOC, DOCX or TXT/],
      ["fake.doc", /not a real DOC/],
      ["missing.pdf", /not found/],
      ["../ok.pdf", /plain file name/],
      ["sub\\ok.pdf", /plain file name/],
    ];
    for (const [name, expected] of cases) {
      const r = await loadResumeFile(dir, name);
      assert.equal(r.ok, false, name);
      if (!r.ok) assert.match(r.problem, expected, name);
    }
  });
});

describe("resolveJob", () => {
  const jobs: ImportJob[] = [
    { id: "j1", title: "Java Developer", status: "OPEN" },
    { id: "j2", title: "HR Executive", status: "OPEN" },
    { id: "j3", title: "HR Executive", status: "CLOSED" },
  ];

  it("matches by id or by a unique title, case-insensitively", () => {
    const byId = resolveJob(jobs, "j3");
    assert.equal(byId.ok && byId.job.status, "CLOSED");
    const byTitle = resolveJob(jobs, "  java developer ");
    assert.equal(byTitle.ok && byTitle.job.id, "j1");
  });

  it("refuses ambiguous or unknown titles", () => {
    const amb = resolveJob(jobs, "HR Executive");
    assert.equal(amb.ok, false);
    if (!amb.ok) assert.match(amb.problem, /matches 2 jobs/);
    const none = resolveJob(jobs, "Designer");
    assert.equal(none.ok, false);
  });
});
