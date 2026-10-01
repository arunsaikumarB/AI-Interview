/**
 * /api/version may expose a git SHA and nothing else.
 *
 *   npx tsx --test tests/unit/build-info.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  publicVersionPayload,
  readBuildCommitFrom,
  sanitizeCommit,
} from "../../src/lib/build-info";

const FULL = "a".repeat(40);

describe("sanitizeCommit", () => {
  it("accepts 7 to 40 hex characters and lowercases them", () => {
    assert.equal(sanitizeCommit("abc1234"), "abc1234");
    assert.equal(sanitizeCommit(`  ${FULL.toUpperCase()}  `), FULL);
  });

  it("rejects everything else", () => {
    for (const value of [
      undefined,
      null,
      123,
      "",
      "abc",
      "a".repeat(41),
      "not-a-sha",
      "abc1234\nDATABASE_URL=secret",
      "../../etc/passwd",
      "deadbeef;",
    ]) {
      assert.equal(sanitizeCommit(value), "unknown", `accepted ${String(value)}`);
    }
  });
});

describe("publicVersionPayload", () => {
  it("returns only service and commit", () => {
    const payload = publicVersionPayload(FULL);
    assert.deepEqual(payload, { service: "Logisoft HireOS", commit: FULL });
    assert.deepEqual(Object.keys(payload).sort(), ["commit", "service"]);
  });

  it("does not pass through unsanitized text", () => {
    const payload = publicVersionPayload("postgres://ats:secret@db/hireos");
    assert.equal(payload.commit, "unknown");
    assert.equal(JSON.stringify(payload).includes("secret"), false);
  });
});

describe("readBuildCommitFrom", () => {
  it("reads the commit and ignores every other key", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireos-build-info-"));
    mkdirSync(join(dir, ".next"), { recursive: true });
    writeFileSync(
      join(dir, ".next", "build-info.json"),
      JSON.stringify({
        commit: FULL,
        storageRoot: "/opt/hireos/storage",
        env: "DATABASE_URL=postgres://nope",
      }),
    );
    assert.equal(readBuildCommitFrom(dir), FULL);
  });

  it("prefers a standalone file beside the server", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireos-build-info-"));
    writeFileSync(join(dir, "build-info.json"), JSON.stringify({ commit: "abc1234" }));
    mkdirSync(join(dir, ".next"), { recursive: true });
    writeFileSync(
      join(dir, ".next", "build-info.json"),
      JSON.stringify({ commit: "bbbbbbb" }),
    );
    assert.equal(readBuildCommitFrom(dir), "abc1234");
  });

  it("ignores an oversized or invalid file", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireos-build-info-"));
    mkdirSync(join(dir, ".next"), { recursive: true });
    writeFileSync(join(dir, ".next", "build-info.json"), "x".repeat(2048));
    assert.equal(readBuildCommitFrom(dir), "unknown");
  });
});

describe("write-build-info.mjs", () => {
  it("writes the same commit for next start and the standalone server", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireos-write-build-info-"));
    mkdirSync(join(dir, ".next", "standalone"), { recursive: true });
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "write-build-info.mjs")],
      {
        cwd: dir,
        env: { ...process.env, HIREOS_BUILD_COMMIT: FULL, GITHUB_SHA: "b".repeat(40) },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(FULL));
    assert.equal(readBuildCommitFrom(dir), FULL);
    assert.equal(readBuildCommitFrom(join(dir, ".next", "standalone")), FULL);
  });
});
