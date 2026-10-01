/**
 * Build-time commit resolution. Only a hex SHA is recorded.
 *
 *   node --test tests/unit/build-commit.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveBuildCommit } from "../../scripts/build-commit.mjs";

const FULL = "a".repeat(40);

describe("resolveBuildCommit", () => {
  it("prefers an explicit hex SHA and never calls git", () => {
    assert.equal(
      resolveBuildCommit({ HIREOS_BUILD_COMMIT: "ABC1234", GITHUB_SHA: FULL }, () => {
        throw new Error("git should not run");
      }),
      "abc1234",
    );
  });

  it("falls through invalid values to GITHUB_SHA, CI_COMMIT_SHA, then git", () => {
    assert.equal(
      resolveBuildCommit({ HIREOS_BUILD_COMMIT: "nope", GITHUB_SHA: FULL }, () => "ccccccc"),
      FULL,
    );
    assert.equal(
      resolveBuildCommit({ CI_COMMIT_SHA: "deadbee" }, () => {
        throw new Error("git should not run");
      }),
      "deadbee",
    );
    assert.equal(
      resolveBuildCommit({ HIREOS_BUILD_COMMIT: "branch-name" }, () => "1234abc"),
      "1234abc",
    );
    assert.equal(
      resolveBuildCommit({}, () => {
        throw new Error("no git");
      }),
      "unknown",
    );
  });
});
