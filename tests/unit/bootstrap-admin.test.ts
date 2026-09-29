/**
 * First-admin bootstrap: input validation and password policy (no database).
 * Database behaviour is covered by tests/bootstrap/bootstrap-admin.db.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alreadyBootstrappedReasons,
  bootstrapAdmin,
  BootstrapError,
  organizationSlug,
  passwordProblems,
  validateBootstrapInput,
  type BootstrapDb,
} from "../../src/lib/bootstrap-admin";

const STRONG = "Correct-Horse-7-Battery";
const base = {
  organizationName: "Logisoft Technologies",
  adminName: "Asha Admin",
  adminEmail: "Asha.Admin@Logisoft.example",
  password: STRONG,
  passwordConfirmation: STRONG,
};

const rejects = (input: typeof base, code: string) =>
  assert.throws(() => validateBootstrapInput(input), (e: unknown) => e instanceof BootstrapError && e.code === code);

/** Fails the test if bootstrap ever reaches the database. */
const untouchableDb: BootstrapDb = {
  $transaction: async () => {
    throw new Error("database must not be touched for invalid input");
  },
};

describe("bootstrap admin — validation", () => {
  it("accepts valid input and normalises email, names and slug", () => {
    const v = validateBootstrapInput({ ...base, organizationName: "  Logisoft Technologies  ", adminName: " Asha Admin " });
    assert.equal(v.organizationName, "Logisoft Technologies");
    assert.equal(v.organizationSlug, "logisoft-technologies");
    assert.equal(v.adminName, "Asha Admin");
    assert.equal(v.adminEmail, "asha.admin@logisoft.example");
  });

  it("derives a URL-safe slug", () => {
    assert.equal(organizationSlug("Café Déjà Vu & Co."), "cafe-deja-vu-co");
    assert.equal(organizationSlug("***"), "");
    assert.ok(organizationSlug("x".repeat(200)).length <= 60);
  });

  it("rejects weak passwords with specific reasons", () => {
    const cases: Array<[string, RegExp]> = [
      ["password123", /at least 12/],
      ["Short-1a", /at least 12/],
      ["alllowercase-123", /uppercase/],
      ["ALLUPPERCASE-123", /lowercase/],
      ["NoDigitsHere-abc", /digit/],
      ["NoSymbols123abc", /symbol/],
      ["MyPassword-2026!", /"password"/],
      ["Asha.admin-2026!", /email name/],
      ["Aa1!" + "x".repeat(80), /72 bytes/],
    ];
    for (const [pw, reason] of cases) {
      const problems = passwordProblems(pw, { adminEmail: "asha.admin@logisoft.example" });
      assert.ok(problems.some((p) => reason.test(p)), `${pw} should fail with ${reason}: ${problems.join("; ")}`);
      rejects({ ...base, password: pw, passwordConfirmation: pw }, "WEAK_PASSWORD");
    }
    assert.deepEqual(passwordProblems(STRONG, { adminEmail: base.adminEmail.toLowerCase() }), []);
  });

  it("rejects a password confirmation mismatch", () => {
    rejects({ ...base, passwordConfirmation: STRONG + "x" }, "PASSWORD_MISMATCH");
  });

  it("rejects invalid organization name, admin name and email", () => {
    rejects({ ...base, organizationName: "A" }, "INVALID_INPUT");
    rejects({ ...base, organizationName: "!!" }, "INVALID_INPUT");
    rejects({ ...base, organizationName: "x".repeat(121) }, "INVALID_INPUT");
    rejects({ ...base, organizationName: "Logi\u0000soft" }, "INVALID_INPUT");
    rejects({ ...base, adminName: " " }, "INVALID_INPUT");
    rejects({ ...base, adminName: "Asha\nAdmin" }, "INVALID_INPUT");
    rejects({ ...base, adminEmail: "not-an-email" }, "INVALID_INPUT");
    rejects({ ...base, adminEmail: "" }, "INVALID_INPUT");
  });

  it("never touches the database for invalid input", async () => {
    for (const input of [
      { ...base, password: "weak", passwordConfirmation: "weak" },
      { ...base, passwordConfirmation: "different" },
      { ...base, adminEmail: "bad" },
    ]) {
      await assert.rejects(bootstrapAdmin(untouchableDb, input), BootstrapError);
    }
  });

  it("explains why a non-fresh database is refused", () => {
    assert.deepEqual(alreadyBootstrappedReasons({ organizations: 0, superAdmins: 0, users: 0 }), []);
    assert.equal(alreadyBootstrappedReasons({ organizations: 1, superAdmins: 0, users: 0 }).length, 1);
    assert.equal(alreadyBootstrappedReasons({ organizations: 0, superAdmins: 1, users: 1 }).length, 1);
    assert.equal(alreadyBootstrappedReasons({ organizations: 0, superAdmins: 0, users: 3 }).length, 1);
  });
});
