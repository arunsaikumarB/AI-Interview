import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// resume-import imports @prisma/client, which copies the repo .env into process.env
// for unset keys. Pin DATABASE_URL so this test can never reach a real database.
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit_test_unreachable";

import { DocReadError, isOleFile, readDocText } from "../../src/lib/resume/doc";
import { isAllowedResumeFile } from "../../src/lib/resume/mime";
import { extractResumeText } from "../../src/lib/resume/parse";
import { checkUploadedResume } from "../../src/lib/resume-import";

const fixture = (name: string) => readFileSync(path.join(__dirname, "..", "fixtures", "resumes", name));
const plain = fixture("resume-plain.doc");

describe("readDocText (Word 97–2003 files saved by Microsoft Word)", () => {
  it("reads the body, tables, hyperlink text and the page header; drops field codes", () => {
    const text = readDocText(plain);
    assert.match(text, /^Ravi Kumar\n/);
    assert.match(text, /Résumé – Senior Java Developer/);
    assert.match(text, /Profile: linkedin\.com\/in\/ravi-kumar-example/);
    assert.match(text, /Skills\tJava, Spring Boot, PostgreSQL/);
    assert.match(text, /Location: Hyderabad, Telangana/);
    assert.match(text, /ravi\.kumar\.doc@example\.com \| \+91 98765 43210/);
    assert.doesNotMatch(text, /HYPERLINK/);
    assert.doesNotMatch(text, /[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });

  it("reads Unicode text (Telugu, euro sign)", () => {
    const text = readDocText(fixture("resume-unicode.doc"));
    assert.match(text, /Native name: రవి €40k budget/);
  });

  it("refuses password-protected files with a clear message", () => {
    assert.throws(() => readDocText(fixture("resume-locked.doc")), (e: unknown) => {
      return e instanceof DocReadError && /Password-protected/.test(e.message);
    });
  });

  it("refuses files that are not Word 97–2003 documents", () => {
    for (const buf of [Buffer.from("%PDF-1.4 x"), Buffer.alloc(0), plain.subarray(0, 8), Buffer.from([0x50, 0x4b, 3, 4])]) {
      assert.throws(() => readDocText(buf), DocReadError);
    }
  });

  it("damaged or random input only ever fails with DocReadError, quickly", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const started = Date.now();
    for (const cut of [512, 1024, 4096, 8192]) {
      assert.throws(() => readDocText(plain.subarray(0, cut)), DocReadError, `cut ${cut}`);
    }
    for (let round = 0; round < 400; round++) {
      const buf = round % 4 === 0 ? plain.subarray(0, rand() % plain.length) : Buffer.from(plain);
      const flips = round % 4 === 0 ? 0 : 1 + (rand() % 16);
      for (let i = 0; i < flips; i++) buf[rand() % buf.length] = rand() & 0xff;
      try {
        assert.equal(typeof readDocText(buf), "string");
      } catch (e) {
        assert.ok(e instanceof DocReadError, `round ${round}: ${(e as Error).name} ${(e as Error).message}`);
      }
    }
    assert.ok(Date.now() - started < 10_000, "too slow");
  });

  it("extractResumeText reads .doc by file name and tidies blank lines", async () => {
    const text = await extractResumeText({ buffer: plain, mimeType: "application/msword", fileName: "Old CV.DOC" });
    assert.match(text, /Senior Java Developer/);
    assert.doesNotMatch(text, /\n{3,}/);
    assert.equal(text, text.trim());
  });

  it("extractResumeText drops NUL characters, which Postgres refuses to store", async () => {
    const buffer = Buffer.from("Ramya\0 Sharma\nSQL\0, Power BI", "utf8");
    const text = await extractResumeText({ buffer, mimeType: "text/plain", fileName: "cv.txt" });
    assert.equal(text, "Ramya Sharma\nSQL, Power BI");
  });
});

describe(".doc is accepted only where staff bring resumes in", () => {
  it("public checks still refuse .doc; staff checks accept it", () => {
    assert.equal(isAllowedResumeFile({ name: "cv.doc", type: "application/msword" }), false);
    assert.equal(isAllowedResumeFile({ name: "cv.doc", type: "application/msword" }, { allowDoc: true }), true);
    assert.equal(isAllowedResumeFile({ name: "cv.docx", type: "" }), true);
    assert.equal(isAllowedResumeFile({ name: "cv.exe", type: "" }, { allowDoc: true }), false);
  });

  it("staff upload check accepts a real .doc and refuses a disguised one", () => {
    assert.equal(isOleFile(plain), true);
    assert.equal(checkUploadedResume("Ravi.doc", "application/msword", plain), null);
    assert.equal(checkUploadedResume("Ravi.doc", "application/msword", Buffer.from("<html>")), "file content is not a real DOC");
    assert.equal(checkUploadedResume("Ravi.pdf", "application/pdf", plain), "file content is not a real PDF");
  });
});
