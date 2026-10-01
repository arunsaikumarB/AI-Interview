import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

// Importing route modules loads @prisma/client, which copies the repo .env into
// process.env for keys that are not already set. Pin both keys first so this
// test can never read the developer .env flag or reach a real database.
process.env.CANDIDATE_ACCOUNTS_ENABLED = "false";
process.env.DATABASE_URL = "postgresql://unit:unit@127.0.0.1:1/unit_test_unreachable";

import {
  candidateAccountsEnabled,
  parseCandidateAccountsEnabled,
} from "../../src/lib/auth/candidate-accounts";
import { AuthError, requireCandidate } from "../../src/lib/auth/rbac";
import type { SessionUser } from "../../src/lib/auth/session";

afterEach(() => {
  process.env.CANDIDATE_ACCOUNTS_ENABLED = "false";
});

const candidate = {
  id: "u1",
  email: "c@example.com",
  name: "Cand",
  role: "CANDIDATE",
  organizationId: "o1",
} as SessionUser;

describe("CANDIDATE_ACCOUNTS_ENABLED", () => {
  it("defaults off and only accepts explicit true values", () => {
    assert.equal(parseCandidateAccountsEnabled(undefined), false);
    assert.equal(parseCandidateAccountsEnabled(""), false);
    assert.equal(parseCandidateAccountsEnabled("false"), false);
    assert.equal(parseCandidateAccountsEnabled("0"), false);
    assert.equal(parseCandidateAccountsEnabled("true"), true);
    assert.equal(parseCandidateAccountsEnabled(" YES "), true);
    assert.equal(parseCandidateAccountsEnabled("1"), true);
  });

  it("is read at runtime", () => {
    process.env.CANDIDATE_ACCOUNTS_ENABLED = "false";
    assert.equal(candidateAccountsEnabled(), false);
    process.env.CANDIDATE_ACCOUNTS_ENABLED = "true";
    assert.equal(candidateAccountsEnabled(), true);
  });
});

describe("requireCandidate (portal APIs)", () => {
  it("rejects an existing candidate session with 403 when accounts are off", () => {
    process.env.CANDIDATE_ACCOUNTS_ENABLED = "false";
    assert.throws(
      () => requireCandidate(candidate),
      (err: unknown) => err instanceof AuthError && err.status === 403,
    );
  });

  it("allows a candidate session when accounts are on", () => {
    process.env.CANDIDATE_ACCOUNTS_ENABLED = "true";
    assert.equal(requireCandidate(candidate).id, "u1");
  });

  it("still rejects staff and anonymous callers", () => {
    process.env.CANDIDATE_ACCOUNTS_ENABLED = "true";
    assert.throws(
      () => requireCandidate({ ...candidate, role: "RECRUITER" } as SessionUser),
      (err: unknown) => err instanceof AuthError && err.status === 403,
    );
    assert.throws(
      () => requireCandidate(null),
      (err: unknown) => err instanceof AuthError && err.status === 401,
    );
  });
});

describe("POST /api/auth/register", () => {
  it("returns 403 before reading the body or the database when accounts are off", async () => {
    process.env.CANDIDATE_ACCOUNTS_ENABLED = "false";
    const { POST } = await import("../../src/app/api/auth/register/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x@example.com", password: "Longenough1!", name: "Someone" }),
      }),
    );
    assert.equal(res.status, 403);
    const json = (await res.json()) as { error?: string };
    assert.match(json.error ?? "", /not available/);
  });
});
