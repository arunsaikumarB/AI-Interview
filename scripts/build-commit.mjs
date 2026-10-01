/**
 * Resolve the commit recorded by postbuild. Shared with unit tests.
 * Accepts only a 7–40 character hex SHA so a bad build arg cannot be echoed.
 */
import { execSync } from "node:child_process";

const SHA = /^[0-9a-f]{7,40}$/i;

const ENV_KEYS = ["HIREOS_BUILD_COMMIT", "GITHUB_SHA", "CI_COMMIT_SHA"];

function defaultReadGit() {
  return execSync("git rev-parse HEAD", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {() => string} [readGit]
 * @returns {string}
 */
export function resolveBuildCommit(env, readGit = defaultReadGit) {
  for (const key of ENV_KEYS) {
    const value = (env[key] ?? "").trim();
    if (SHA.test(value)) return value.toLowerCase();
  }
  try {
    const sha = readGit().trim();
    if (SHA.test(sha)) return sha.toLowerCase();
  } catch {
    // Docker builds exclude .git. The endpoint then reports "unknown".
  }
  return "unknown";
}
