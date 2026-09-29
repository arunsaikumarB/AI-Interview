/**
 * First-admin bootstrap against a real, THROWAWAY PostgreSQL database.
 *
 *   BOOTSTRAP_TEST_DATABASE_URL=postgresql://…@127.0.0.1:<port>/hireos_bootstrap_test… \
 *     npx tsx --test --test-concurrency=1 tests/bootstrap/bootstrap-admin.db.test.ts
 *
 * The schema must already exist (`prisma db push --skip-generate` on that database).
 * Every test empties "Organization" and "User", so the guard below refuses anything
 * that is not a loopback database whose name starts with hireos_bootstrap_test.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { bootstrapAdmin, BootstrapError, type BootstrapDb } from "../../src/lib/bootstrap-admin";

const RAW_URL = process.env.BOOTSTRAP_TEST_DATABASE_URL ?? "";

function assertThrowawayUrl(raw: string): string {
  assert.ok(raw, "BOOTSTRAP_TEST_DATABASE_URL is required (a throwaway database)");
  const url = new URL(raw);
  const dbName = url.pathname.replace(/^\//, "");
  assert.match(dbName, /^hireos_bootstrap_test/, "refusing: database name must start with hireos_bootstrap_test");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "refusing: throwaway database must be on loopback");
  assert.notEqual(raw, process.env.DATABASE_URL, "refusing: BOOTSTRAP_TEST_DATABASE_URL equals DATABASE_URL");
  return raw;
}

const url = assertThrowawayUrl(RAW_URL);
const prisma = new PrismaClient({ datasources: { db: { url } } });

const PASSWORD = "Correct-Horse-7-Battery";
const input = {
  organizationName: "Logisoft Technologies",
  adminName: "Asha Admin",
  adminEmail: "Asha.Admin@Logisoft.example",
  password: PASSWORD,
  passwordConfirmation: PASSWORD,
};

async function tableRowCounts(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string; rows: number }>>`
    SELECT table_name::text AS table_name,
           (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text::int AS rows
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  return Object.fromEntries(rows.map((r) => [r.table_name, r.rows]));
}

const nonEmpty = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));

async function emptyAccounts() {
  await prisma.$executeRaw`TRUNCATE "User", "Organization" CASCADE`;
}

before(async () => {
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  assert.match(db, /^hireos_bootstrap_test/, "refusing: connected database is not a bootstrap test database");
  assert.deepEqual(nonEmpty(await tableRowCounts()), {}, "throwaway database must start empty");
});

beforeEach(emptyAccounts);

after(async () => {
  await emptyAccounts();
  await prisma.$disconnect();
});

describe("bootstrap admin (real PostgreSQL, throwaway database)", () => {
  it("1+9. creates exactly one organization and one SUPER_ADMIN and nothing else", async () => {
    const result = await bootstrapAdmin(prisma, input);
    assert.deepEqual(nonEmpty(await tableRowCounts()), { Organization: 1, User: 1 });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: result.organization.id } });
    assert.equal(org.name, "Logisoft Technologies");
    assert.equal(org.slug, "logisoft-technologies");
    assert.equal(org.companyName, "Logisoft Technologies");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.admin.id } });
    assert.equal(user.role, "SUPER_ADMIN");
    assert.equal(user.email, "asha.admin@logisoft.example");
    assert.equal(user.name, "Asha Admin");
    assert.equal(user.isActive, true);
    assert.equal(user.organizationId, org.id);
    assert.equal(user.departmentId, null);
  });

  it("2. hashes the password with bcrypt cost 12 so the normal login check accepts it", async () => {
    const { admin } = await bootstrapAdmin(prisma, input);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    assert.match(user.passwordHash, /^\$2[aby]\$12\$/);
    assert.equal(bcrypt.getRounds(user.passwordHash), 12);
    // Same lookup + comparison as src/app/api/auth/login/route.ts.
    const loginUser = await prisma.user.findUnique({ where: { email: input.adminEmail.toLowerCase() } });
    assert.ok(loginUser?.isActive);
    assert.equal(await bcrypt.compare(PASSWORD, loginUser.passwordHash), true);
    assert.equal(await bcrypt.compare(PASSWORD + "x", loginUser.passwordHash), false);
  });

  it("3. never stores the plaintext password anywhere", async () => {
    await bootstrapAdmin(prisma, input);
    const dumps = await prisma.$queryRaw<Array<{ j: string }>>`
      SELECT row_to_json(u)::text AS j FROM "User" u
      UNION ALL SELECT row_to_json(o)::text FROM "Organization" o`;
    assert.equal(dumps.length, 2);
    for (const { j } of dumps) assert.ok(!j.includes(PASSWORD), "plaintext password found in a stored row");
  });

  it("4. rejects a weak password and creates nothing", async () => {
    await assert.rejects(
      bootstrapAdmin(prisma, { ...input, password: "password123", passwordConfirmation: "password123" }),
      (e: unknown) => e instanceof BootstrapError && e.code === "WEAK_PASSWORD",
    );
    assert.deepEqual(nonEmpty(await tableRowCounts()), {});
  });

  it("5. rejects a password confirmation mismatch and creates nothing", async () => {
    await assert.rejects(
      bootstrapAdmin(prisma, { ...input, passwordConfirmation: PASSWORD + "!" }),
      (e: unknown) => e instanceof BootstrapError && e.code === "PASSWORD_MISMATCH",
    );
    assert.deepEqual(nonEmpty(await tableRowCounts()), {});
  });

  it("6. refuses when an organization already exists and leaves it untouched", async () => {
    const existing = await prisma.organization.create({ data: { name: "Existing Org", slug: "existing-org" } });
    await assert.rejects(
      bootstrapAdmin(prisma, input),
      (e: unknown) => e instanceof BootstrapError && e.code === "ALREADY_BOOTSTRAPPED",
    );
    assert.deepEqual(nonEmpty(await tableRowCounts()), { Organization: 1 });
    assert.deepEqual(await prisma.organization.findUniqueOrThrow({ where: { id: existing.id } }), existing);
  });

  it("7. refuses when a SUPER_ADMIN already exists and leaves it untouched", async () => {
    const existing = await prisma.user.create({
      data: { email: "root@elsewhere.example", name: "Existing Root", role: "SUPER_ADMIN", passwordHash: "$2b$12$existing" },
    });
    await assert.rejects(
      bootstrapAdmin(prisma, input),
      (e: unknown) => e instanceof BootstrapError && e.code === "ALREADY_BOOTSTRAPPED",
    );
    assert.deepEqual(nonEmpty(await tableRowCounts()), { User: 1 });
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: existing.id } }), existing);
  });

  it("8. rolls back the organization when creating the admin fails", async () => {
    const failing = prisma.$extends({
      query: {
        user: {
          async create() {
            throw new Error("injected user.create failure");
          },
        },
      },
    });
    await assert.rejects(bootstrapAdmin(failing as unknown as BootstrapDb, input), /injected user\.create failure/);
    assert.deepEqual(nonEmpty(await tableRowCounts()), {});
  });

  it("10. running twice creates no duplicates and does not modify the first admin", async () => {
    const first = await bootstrapAdmin(prisma, input);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: first.admin.id } });
    await assert.rejects(
      bootstrapAdmin(prisma, { ...input, organizationName: "Second Org", adminEmail: "second@logisoft.example" }),
      (e: unknown) => e instanceof BootstrapError && e.code === "ALREADY_BOOTSTRAPPED",
    );
    await assert.rejects(bootstrapAdmin(prisma, input), BootstrapError);
    assert.deepEqual(nonEmpty(await tableRowCounts()), { Organization: 1, User: 1 });
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: first.admin.id } }), before);
  });

  it("10b. concurrent runs: exactly one succeeds", async () => {
    const results = await Promise.allSettled([
      bootstrapAdmin(prisma, input),
      bootstrapAdmin(prisma, { ...input, organizationName: "Parallel Org", adminEmail: "parallel@logisoft.example" }),
      bootstrapAdmin(prisma, { ...input, organizationName: "Third Org", adminEmail: "third@logisoft.example" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of results) {
      if (r.status === "rejected") assert.ok(r.reason instanceof BootstrapError && r.reason.code === "ALREADY_BOOTSTRAPPED");
    }
    assert.deepEqual(nonEmpty(await tableRowCounts()), { Organization: 1, User: 1 });
  });
});
