import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { publicResumeText, stripPageMarkers } from "../../src/lib/resume/text";

describe("stripPageMarkers", () => {
  it("removes PDF reader page lines and keeps the resume text", () => {
    const raw = "Ada Lovelace\nPython, SQL\n\n-- 1 of 2 --\n\nExperience\n  --  2 of 2 --  ";
    assert.equal(stripPageMarkers(raw), "Ada Lovelace\nPython, SQL\n\nExperience");
  });

  it("a scanned PDF whose only text is markers becomes empty", () => {
    assert.equal(stripPageMarkers("-- 1 of 2 --\n\n-- 2 of 2 --"), "");
  });

  it("leaves dashes inside real content alone", () => {
    const raw = "Led team -- 5 of 8 engineers promoted\n-- notes --";
    assert.equal(stripPageMarkers(raw), raw);
  });
});

describe("publicResumeText", () => {
  it("cleans stored text from before extraction stripped markers", () => {
    assert.equal(publicResumeText("Ada\n-- 1 of 1 --"), "Ada");
    assert.equal(publicResumeText("-- 1 of 1 --"), null);
    assert.equal(publicResumeText(null), null);
  });
});
