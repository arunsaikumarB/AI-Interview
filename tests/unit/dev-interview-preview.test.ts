/**
 * /dev/interview-preview stays available outside production and is blocked
 * when NODE_ENV is production. Middleware uses the same helper.
 *
 *   npx tsx --test tests/unit/dev-interview-preview.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  devInterviewPreviewBlocked,
  isDevInterviewPreviewPath,
} from "../../src/lib/dev-interview-preview";

describe("dev interview preview path", () => {
  it("matches the page and its subpaths only", () => {
    assert.equal(isDevInterviewPreviewPath("/dev/interview-preview"), true);
    assert.equal(isDevInterviewPreviewPath("/dev/interview-preview/"), true);
    assert.equal(isDevInterviewPreviewPath("/dev/interview-preview/extra"), true);
    assert.equal(isDevInterviewPreviewPath("/dev/interview-preview-other"), false);
    assert.equal(isDevInterviewPreviewPath("/login"), false);
    assert.equal(isDevInterviewPreviewPath("/interview/token"), false);
  });
});

describe("dev interview preview availability", () => {
  it("is blocked only in production", () => {
    assert.equal(devInterviewPreviewBlocked("production", "/dev/interview-preview"), true);
    assert.equal(devInterviewPreviewBlocked("development", "/dev/interview-preview"), false);
    assert.equal(devInterviewPreviewBlocked("test", "/dev/interview-preview"), false);
    assert.equal(devInterviewPreviewBlocked(undefined, "/dev/interview-preview"), false);
  });

  it("does not block other paths in production", () => {
    assert.equal(devInterviewPreviewBlocked("production", "/login"), false);
    assert.equal(devInterviewPreviewBlocked("production", "/api/health"), false);
    assert.equal(devInterviewPreviewBlocked("production", "/dev/interview-preview-other"), false);
  });
});
