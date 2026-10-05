import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractResumeFields } from "../../src/lib/resume-upload/extract";
import { rowWarnings, uploadRowSchema } from "../../src/lib/resume-upload/constants";

describe("extractResumeFields", () => {
  it("reads name, email, phone and experience from a typical resume", () => {
    const text = [
      "RESUME",
      "ELURU HEMA NAGESWARI",
      "Email: Eluru.Hema@Gmail.com | Mobile: +91 98765 43210",
      "Hyderabad, Telangana",
      "PROFESSIONAL SUMMARY",
      "Java developer with 3.5 years of experience in Spring Boot and microservices.",
    ].join("\n");
    assert.deepEqual(extractResumeFields(text, "cv.pdf"), {
      firstName: "Eluru",
      lastName: "Hema Nageswari",
      email: "eluru.hema@gmail.com",
      phone: "+91 98765 43210",
      experience: 3.5,
    });
  });

  it("keeps mixed-case names as written and strips a Name: label", () => {
    const f = extractResumeFields("Name: Devi Parvathi Janapamula\njanapamuladevi5@gmail.com", "x.pdf");
    assert.equal(f.firstName, "Devi");
    assert.equal(f.lastName, "Parvathi Janapamula");
  });

  it("skips headings, contact lines and addresses when looking for the name", () => {
    const text = "Curriculum Vitae\nContact Details\n12-3-45, Ameerpet\nPraveen Nandan K\npraveen@x.com";
    const f = extractResumeFields(text, "x.pdf");
    assert.equal(f.firstName, "Praveen");
    assert.equal(f.lastName, "Nandan K");
  });

  it("joins letter-spaced names from designed resumes", () => {
    const f = extractResumeFields("S e e t h a r a m i \tR e d d y\nUX Designer with 4+ years of experience", "x.pdf");
    assert.equal(f.firstName, "Seetharami");
    assert.equal(f.lastName, "Reddy");
    const tabs = extractResumeFields("VENKATA \tSAI \tCHIKKALA\nAWS \tDevOps \tEngineer", "x.pdf");
    assert.equal(`${tabs.firstName} ${tabs.lastName}`, "Venkata Sai Chikkala");
  });

  it("never takes a company, job title or text after the first section heading as the name", () => {
    const text = "4+ years designing web apps\nExperienc\nSenior UX Designe \tSep 2024 - Presen\nUXInterfacely IT Solution";
    assert.equal(extractResumeFields(text, "1787054258_Naukri_SeethaRam[4y_7m].pdf").firstName, "Seetha");
    assert.equal(extractResumeFields("Infosys Technologies Limited\nSoftware Engineer", "x.pdf").firstName, "");
    assert.equal(extractResumeFields("Professional Summary\nAsha Rao", "asha_rao.pdf").lastName, "Rao");
  });

  it("falls back to the file name when the text has no usable name", () => {
    assert.equal(extractResumeFields("", "bhavani_dasari_Resume_8555.pdf").firstName, "Bhavani");
    assert.equal(extractResumeFields("", "bhavani_dasari_Resume_8555.pdf").lastName, "Dasari");
    const naukri = extractResumeFields("", "1787054258_Naukri_SeethaRam[4y_7m].pdf");
    assert.equal(`${naukri.firstName} ${naukri.lastName}`, "Seetha Ram");
    assert.equal(naukri.experience, 4.6);
    const joined = extractResumeFields("", "1787055442_Venkatresume.pdf");
    assert.equal(joined.firstName, "Venkat");
    assert.equal(joined.lastName, "");
  });

  it("returns blanks rather than guesses when nothing is found", () => {
    assert.deepEqual(extractResumeFields("", "12345.pdf"), {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      experience: null,
    });
  });

  it("prefers an Indian mobile number and ignores year ranges", () => {
    const text = "Education 2015 - 2019 2020\nOffice: 040 2345 6789\nPhone: 9876543210";
    assert.equal(extractResumeFields(text, "x.pdf").phone, "9876543210");
    assert.equal(extractResumeFields("Tel 040 2345 6789", "x.pdf").phone, "040 2345 6789");
    assert.equal(extractResumeFields("2015-2019 B.Tech", "x.pdf").phone, "");
  });

  it("never reads a phone number out of an email address or across lines", () => {
    assert.equal(extractResumeFields("ravi1791201861926@example.com\n9876543210\n4 years", "x.pdf").phone, "9876543210");
    assert.equal(extractResumeFields("ravi9876543210@gmail.com", "x.pdf").phone, "");
  });

  it("reads common experience phrasings and freshers", () => {
    const exp = (t: string) => extractResumeFields(t, "x.pdf").experience;
    assert.equal(exp("Over 5+ years of professional IT experience"), 5);
    assert.equal(exp("2 years and 6 months of experience"), 2.5);
    assert.equal(exp("Total Experience: 7 yrs"), 7);
    assert.equal(exp("Fresher looking for an opportunity"), 0);
    assert.equal(exp("Graduated in 2019"), null);
    assert.equal(exp("99 years of experience"), null);
  });

  it("takes the first email and lowercases it", () => {
    assert.equal(extractResumeFields("a: Ravi.K@Example.co.in, b: other@x.com", "x.pdf").email, "ravi.k@example.co.in");
  });
});

describe("uploadRowSchema", () => {
  const base = {
    fileName: "a.pdf",
    firstName: "Ravi",
    lastName: "",
    email: " Ravi@Example.com ",
    phone: "+91 98765 43210",
    experience: 3,
  };

  it("accepts a reviewed row and normalises the email", () => {
    const r = uploadRowSchema.parse(base);
    assert.equal(r.email, "ravi@example.com");
    assert.equal(r.lastName, "");
  });

  it("rejects missing first name, bad email, bad phone and out-of-range experience", () => {
    assert.equal(uploadRowSchema.safeParse({ ...base, firstName: " " }).success, false);
    assert.equal(uploadRowSchema.safeParse({ ...base, email: "not-an-email" }).success, false);
    assert.equal(uploadRowSchema.safeParse({ ...base, phone: "<script>" }).success, false);
    assert.equal(uploadRowSchema.safeParse({ ...base, experience: 51 }).success, false);
    assert.equal(uploadRowSchema.safeParse({ ...base, experience: null }).success, true);
  });
});

describe("rowWarnings", () => {
  it("flags emails and phones that look cut off, without blocking normal values", () => {
    assert.deepEqual(rowWarnings({ email: "seetharam.uxdesign@gmail.co", phone: "+91 630286261" }), [
      "email looks cut off",
      "phone looks incomplete",
    ]);
    assert.deepEqual(rowWarnings({ email: "ravi@gmail.com", phone: "+91 98765 43210" }), []);
    assert.deepEqual(rowWarnings({ email: "ravi@example.co", phone: "9876543210" }), []);
    assert.deepEqual(rowWarnings({ email: "a@yahoo.co.in", phone: "" }), []);
    assert.deepEqual(rowWarnings({ email: "", phone: "98765" }), ["phone looks incomplete"]);
  });
});
