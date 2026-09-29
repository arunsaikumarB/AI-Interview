/**
 * V3.0 SQL sandbox — REAL isolation tests (security tests 16–25 + SQL integration).
 * Queries go through the real runner into the real hireos-sql-sandbox container,
 * and direct connections as the task role prove the DATABASE enforces the rules
 * (not just the runner).
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { psqlAs, runnerAvailable, runSql, sqlRolePassword, taskDb } from "./helpers";

const TASK = "sql-customers-per-city";
const OTHER = "sql-revenue-by-category";
const { db, role } = taskDb(TASK);
const other = taskDb(OTHER);
const password = sqlRolePassword(role);

function direct(sql: string | string[], database = db) {
  return psqlAs(role, password, database, sql);
}

before(async () => {
  assert.ok(await runnerAvailable(), "sandbox runner is not running — start it with `npm run sandbox:runner`");
  assert.ok(direct("SELECT 1").ok, "direct role connection to its own task database must work");
});

describe("SQL sandbox security (real execution)", () => {
  it("#16 cannot access the production HireOS database (separate server; no cross-db, no dblink)", async () => {
    const onServer = await runSql(TASK, "SELECT count(*) AS n FROM pg_database WHERE datname = 'ai_recruitment_os'");
    assert.equal(onServer.body?.status, "OK");
    assert.equal(onServer.body?.rows?.[0]?.[0], "0", "the HireOS database must not exist on the SQL sandbox server");
    const crossDb = await runSql(TASK, 'SELECT * FROM ai_recruitment_os.public."User"');
    assert.equal(crossDb.body?.status, "SQL_ERROR");
    const dblink = await runSql(TASK, "SELECT * FROM dblink('host=host.docker.internal port=55432 dbname=ai_recruitment_os', 'select 1') AS t(x int)");
    assert.equal(dblink.body?.status, "SQL_ERROR");
    assert.equal(direct("SELECT 1", "ai_recruitment_os").ok, false);
  });

  it("#17 cannot access another assessment database", async () => {
    const viaRunner = await runSql(TASK, `SELECT * FROM ${other.db}.assessment.customers`);
    assert.equal(viaRunner.body?.status, "SQL_ERROR");
    const cross = direct("SELECT 1", other.db);
    assert.equal(cross.ok, false);
    assert.match(cross.output, /permission denied for database/i);
    for (const database of ["sandbox_admin", "postgres", "template1"]) {
      assert.equal(direct("SELECT 1", database).ok, false, `role must not connect to ${database}`);
    }
  });

  it("#18 cannot DROP (runner and direct connection)", async () => {
    const r = await runSql(TASK, "DROP TABLE customers");
    assert.equal(r.body?.status, "SQL_ERROR");
    const d = direct(["SET default_transaction_read_only = off", "DROP TABLE customers"]);
    assert.equal(d.ok, false);
    assert.match(d.output, /must be owner|permission denied/i);
    assert.equal(direct("SELECT count(*) FROM customers").output.trim(), "13");
  });

  it("#19 cannot ALTER", async () => {
    const r = await runSql(TASK, "ALTER TABLE customers ADD COLUMN pwned int");
    assert.equal(r.body?.status, "SQL_ERROR");
    const d = direct(["SET default_transaction_read_only = off", "ALTER TABLE customers ADD COLUMN pwned int"]);
    assert.equal(d.ok, false);
    assert.match(d.output, /must be owner|permission denied/i);
  });

  it("#20 cannot create privileged users or escalate privileges", async () => {
    const r = await runSql(TASK, "CREATE ROLE evil SUPERUSER LOGIN");
    assert.equal(r.body?.status, "SQL_ERROR");
    for (const stmt of [
      "CREATE ROLE evil SUPERUSER LOGIN PASSWORD 'x'",
      `ALTER ROLE ${role} SUPERUSER`,
      `GRANT pg_read_server_files TO ${role}`,
      "SET ROLE sandbox_admin",
    ]) {
      const d = direct(["SET default_transaction_read_only = off", stmt]);
      assert.equal(d.ok, false, `${stmt} must be rejected`);
      assert.match(d.output, /permission denied|must be superuser|not permitted|must have/i);
    }
    const flags = direct("SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = current_user");
    assert.equal(flags.output.trim(), "f|f|f|f|f");
  });

  it("#21 cannot read or write the server filesystem", async () => {
    for (const q of [
      "SELECT pg_read_file('/etc/passwd')",
      "SELECT * FROM pg_ls_dir('.')",
      "SELECT lo_import('/etc/passwd')",
      "SELECT pg_stat_file('/etc/passwd')",
    ]) {
      const r = await runSql(TASK, q);
      assert.equal(r.body?.status, "SQL_ERROR", `${q} must fail: ${JSON.stringify(r.body)}`);
    }
    for (const stmt of ["COPY customers TO '/tmp/leak.csv'", "COPY (SELECT 1) TO PROGRAM 'id'", "COPY customers FROM '/etc/passwd'"]) {
      const d = direct(["SET default_transaction_read_only = off", stmt]);
      assert.equal(d.ok, false, `${stmt} must be rejected`);
      assert.match(d.output, /permission denied|must be superuser|pg_write_server_files|pg_read_server_files|pg_execute_server_program/i);
    }
  });

  it("#22 cannot reach external services (no dblink/postgres_fdw, cannot install extensions)", async () => {
    const ext = await runSql(
      TASK,
      "SELECT count(*) FROM pg_extension WHERE extname IN ('dblink', 'postgres_fdw', 'file_fdw', 'plpython3u', 'plperlu')",
    );
    assert.equal(ext.body?.rows?.[0]?.[0], "0");
    const d = direct(["SET default_transaction_read_only = off", "CREATE EXTENSION dblink"]);
    assert.equal(d.ok, false);
    assert.match(d.output, /permission denied|must be|not allowed/i);
  });

  it("#23 timeout terminates slow and infinite queries", async () => {
    const started = Date.now();
    const sleepQ = await runSql(TASK, "SELECT pg_sleep(10)", { timeoutMs: 1000, maxRows: 10, maxResultBytes: 4096 });
    assert.equal(sleepQ.body?.status, "TIMEOUT");
    assert.ok(Date.now() - started < 6000, "pg_sleep(10) must be cut off near the 1 s limit");
    const cpuBound = Date.now();
    const endless = await runSql(
      TASK,
      "SELECT count(*) FROM generate_series(1, 40000) a WHERE (SELECT count(*) FROM generate_series(1, 40000) b WHERE b > a) >= 0",
      { timeoutMs: 1500, maxRows: 10, maxResultBytes: 4096 },
    );
    assert.equal(endless.body?.status, "TIMEOUT", JSON.stringify(endless.body));
    assert.ok(Date.now() - cpuBound < 7000);
    // Unbounded recursion is stopped by whichever limit trips first: statement timeout or temp_file_limit.
    const infinite = await runSql(
      TASK,
      "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) FROM r",
      { timeoutMs: 1500, maxRows: 10, maxResultBytes: 4096 },
    );
    assert.ok(
      infinite.body?.status === "TIMEOUT" || (infinite.body?.status === "SQL_ERROR" && infinite.body?.sqlState === "53400"),
      JSON.stringify(infinite.body),
    );
    const lingering = direct(`SELECT count(*) FROM pg_stat_activity WHERE usename = '${role}' AND state = 'active' AND pid <> pg_backend_pid()`);
    assert.equal(lingering.output.trim(), "0", "no query may keep running after the timeout");
  });

  it("#24 row and result-size limits work", async () => {
    const rows = await runSql(TASK, "SELECT g FROM generate_series(1, 100000) AS g", { timeoutMs: 3000, maxRows: 500, maxResultBytes: 131072 });
    assert.equal(rows.body?.status, "ROW_LIMIT");
    assert.equal(rows.body?.rows?.length, 500);
    assert.equal(rows.body?.rowLimitExceeded, true);
    const bytes = await runSql(TASK, "SELECT repeat('x', 60000) FROM generate_series(1, 10)", { timeoutMs: 3000, maxRows: 500, maxResultBytes: 131072 });
    assert.equal(bytes.body?.status, "ROW_LIMIT");
    assert.equal(bytes.body?.resultTruncated, true);
    assert.ok(bytes.body?.rows?.length < 10);
  });

  it("#25 database permissions themselves enforce the restrictions (bypassing the runner)", async () => {
    const insert = direct(["SET default_transaction_read_only = off", "INSERT INTO customers (id, name, signup_date) VALUES (99, 'x', now())"]);
    assert.equal(insert.ok, false);
    assert.match(insert.output, /permission denied for table customers/i);
    const create = direct(["SET default_transaction_read_only = off", "CREATE TABLE pwned (x int)"]);
    assert.equal(create.ok, false);
    assert.match(create.output, /permission denied for schema/i);
    const temp = direct(["SET default_transaction_read_only = off", "CREATE TEMP TABLE pwned (x int)"]);
    assert.equal(temp.ok, false);
    assert.match(temp.output, /permission denied to create temporary tables/i);
    const readOnly = direct("SHOW default_transaction_read_only");
    assert.equal(readOnly.output.trim(), "on");
  });
});

describe("SQL runtime integration (real execution)", () => {
  it("LIKE with % works, multiple statements are rejected, DML is rejected", async () => {
    const like = await runSql(TASK, "SELECT name FROM customers WHERE name LIKE 'A%' ORDER BY id;");
    assert.equal(like.body?.status, "OK");
    assert.deepEqual(like.body?.rows, [["Asha Rao"]]);
    const multi = await runSql(TASK, "SELECT 1; DELETE FROM customers");
    assert.equal(multi.body?.status, "SQL_ERROR");
    const dml = await runSql(TASK, "UPDATE customers SET city = 'X'");
    assert.equal(dml.body?.status, "SQL_ERROR");
    const cte = await runSql(TASK, "WITH d AS (DELETE FROM customers RETURNING *) SELECT * FROM d");
    assert.equal(cte.body?.status, "SQL_ERROR");
    assert.equal(direct("SELECT count(*) FROM customers").output.trim(), "13");
  });
});
