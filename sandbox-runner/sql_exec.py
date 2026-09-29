"""
SQL execution against the dedicated sandbox Postgres (never the HireOS database).

Isolation is enforced by the database itself:
  * every task has its own database and its own LOGIN role;
  * PUBLIC has no CONNECT on any database, so a task role can reach only its own;
  * the role has USAGE on schema `assessment` and SELECT on its tables — nothing else;
  * sessions default to read-only; the runner additionally opens READ ONLY transactions
    and always rolls back;
  * the query runs as `DECLARE c NO SCROLL CURSOR FOR <query>` through the extended
    protocol, so only a single read query is accepted, and rows are pulled with a
    bounded FETCH.
"""

import hashlib
import hmac
import json
import os
import re
import threading
import time

import psycopg
from psycopg import pq, sql

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST_PATH = os.path.join(HERE, "sql_tasks.json")
DATASET_DIR = os.path.join(HERE, "datasets")

HARD = {"query_max_bytes": 8 * 1024, "timeout_ms": 5000, "max_rows": 1000, "max_result_bytes": 256 * 1024}
NUMERIC_OIDS = {20, 21, 23, 26, 700, 701, 1700}
BOOL_OID = 16
TASK_RE = re.compile(r"^[a-z0-9-]{1,48}$")


class BadRequest(Exception):
    pass


class Config:
    def __init__(self, env):
        self.host = env.get("SQL_SANDBOX_HOST", "127.0.0.1")
        self.port = int(env.get("SQL_SANDBOX_PORT", "55433"))
        self.admin_user = env.get("SQL_SANDBOX_ADMIN_USER", "sandbox_admin")
        self.admin_password = env.get("SQL_SANDBOX_ADMIN_PASSWORD", "")
        self.admin_db = env.get("SQL_SANDBOX_ADMIN_DB", "sandbox_admin")
        self.role_secret = env.get("SQL_SANDBOX_ROLE_SECRET", "")
        if len(self.admin_password) < 24 or len(self.role_secret) < 32:
            raise RuntimeError("SQL sandbox secrets are missing or too short")


def load_manifest():
    with open(MANIFEST_PATH, encoding="utf-8") as f:
        manifest = json.load(f)
    out = {}
    for entry in manifest["tasks"]:
        key, version, dataset = entry["taskKey"], int(entry["taskVersion"]), entry["dataset"]
        if not TASK_RE.match(key) or not re.match(r"^[a-z0-9_]{1,32}$", dataset):
            raise RuntimeError("invalid manifest entry")
        db = "sqltask_%s_v%d" % (key.replace("-", "_"), version)
        out[(key, version)] = {"db": db, "role": db + "_ro", "dataset": dataset}
    return out


def role_password(cfg, role):
    return hmac.new(cfg.role_secret.encode(), role.encode(), hashlib.sha256).hexdigest()


def _admin_connect(cfg, dbname):
    return psycopg.connect(
        host=cfg.host, port=cfg.port, dbname=dbname, user=cfg.admin_user,
        password=cfg.admin_password, connect_timeout=5, autocommit=True,
        application_name="hireos-sandbox-provision",
    )


def provision(cfg, manifest):
    """Idempotently create per-task databases, roles, datasets and grants."""
    with _admin_connect(cfg, cfg.admin_db) as admin:
        for dbname in (cfg.admin_db, "postgres", "template1"):
            admin.execute(sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(dbname)))
        for spec in manifest.values():
            db, role = spec["db"], spec["role"]
            exists = admin.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone()
            verb = "ALTER" if exists else "CREATE"
            admin.execute(
                sql.SQL(
                    verb + " ROLE {} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT "
                    "NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD {}"
                ).format(sql.Identifier(role), sql.Literal(role_password(cfg, role)))
            )
            for setting, value in (
                ("default_transaction_read_only", "on"),
                ("statement_timeout", "5000"),
                ("idle_in_transaction_session_timeout", "10000"),
                ("temp_file_limit", "8MB"),
                ("work_mem", "4MB"),
                ("search_path", "assessment"),
            ):
                admin.execute(
                    sql.SQL("ALTER ROLE {} SET {} = {}").format(
                        sql.Identifier(role), sql.Identifier(setting), sql.Literal(value)
                    )
                )
            if not admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db,)).fetchone():
                admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(db)))
            admin.execute(sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(db)))
            admin.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(sql.Identifier(db), sql.Identifier(role)))
            _load_dataset(cfg, db, role, spec["dataset"])


def _load_dataset(cfg, db, role, dataset):
    path = os.path.join(DATASET_DIR, dataset + ".sql")
    with open(path, encoding="utf-8") as f:
        script = f.read()
    digest = hashlib.sha256(script.encode()).hexdigest()
    with _admin_connect(cfg, db) as conn:
        conn.execute("CREATE SCHEMA IF NOT EXISTS hireos_meta")
        conn.execute("REVOKE ALL ON SCHEMA hireos_meta FROM PUBLIC")
        conn.execute("CREATE TABLE IF NOT EXISTS hireos_meta.dataset (key text PRIMARY KEY, sha256 text NOT NULL)")
        row = conn.execute("SELECT sha256 FROM hireos_meta.dataset WHERE key = %s", (dataset,)).fetchone()
        if not row or row[0] != digest:
            with conn.transaction():
                conn.execute("DROP SCHEMA IF EXISTS assessment CASCADE")
                conn.execute("CREATE SCHEMA assessment")
                conn.execute("SET LOCAL search_path = assessment")
                conn.execute(script)
                conn.execute(
                    "INSERT INTO hireos_meta.dataset (key, sha256) VALUES (%s, %s) "
                    "ON CONFLICT (key) DO UPDATE SET sha256 = EXCLUDED.sha256",
                    (dataset, digest),
                )
        conn.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
        conn.execute("REVOKE ALL ON SCHEMA assessment FROM PUBLIC")
        conn.execute(sql.SQL("GRANT USAGE ON SCHEMA assessment TO {}").format(sql.Identifier(role)))
        conn.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA assessment TO {}").format(sql.Identifier(role)))


def _clamp(value, lo, hi):
    try:
        v = int(value)
    except (TypeError, ValueError):
        raise BadRequest("invalid limit")
    return max(lo, min(hi, v))


def validate(body, manifest):
    if not isinstance(body, dict) or set(body) != {"taskKey", "taskVersion", "query", "limits"}:
        raise BadRequest("unexpected fields")
    key, version, query, limits = body["taskKey"], body["taskVersion"], body["query"], body["limits"]
    if not isinstance(key, str) or not TASK_RE.match(key) or not isinstance(version, int):
        raise BadRequest("invalid task")
    spec = manifest.get((key, version))
    if spec is None:
        raise BadRequest("unknown task")
    if not isinstance(query, str) or "\x00" in query or len(query.encode("utf-8")) > HARD["query_max_bytes"]:
        raise BadRequest("invalid query")
    query = query.strip()
    while query.endswith(";"):
        query = query[:-1].rstrip()
    if not query:
        raise BadRequest("empty query")
    if not isinstance(limits, dict):
        raise BadRequest("invalid limits")
    clean = {
        "timeoutMs": _clamp(limits.get("timeoutMs"), 100, HARD["timeout_ms"]),
        "maxRows": _clamp(limits.get("maxRows"), 1, HARD["max_rows"]),
        "maxResultBytes": _clamp(limits.get("maxResultBytes"), 1024, HARD["max_result_bytes"]),
    }
    return spec, query, clean


def _error(res):
    state = (res.error_field(pq.DiagnosticField.SQLSTATE) or b"").decode()
    primary = (res.error_field(pq.DiagnosticField.MESSAGE_PRIMARY) or b"query failed").decode("utf-8", "replace")
    return state, primary.splitlines()[0][:300]


def execute(cfg, manifest, body):
    spec, query, limits = validate(body, manifest)
    started = time.monotonic()
    try:
        conn = psycopg.connect(
            host=cfg.host, port=cfg.port, dbname=spec["db"], user=spec["role"],
            password=role_password(cfg, spec["role"]), connect_timeout=5, autocommit=True,
            application_name="hireos-sandbox-query",
        )
    except psycopg.Error:
        return {"status": "INFRA_ERROR"}

    watchdog = threading.Timer(limits["timeoutMs"] / 1000 + 2, lambda: _cancel(conn))
    watchdog.start()
    try:
        raw = conn.pgconn
        for stmt in (
            b"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
            ("SET LOCAL statement_timeout = %d" % limits["timeoutMs"]).encode(),
        ):
            res = raw.exec_(stmt)
            if res.status != pq.ExecStatus.COMMAND_OK:
                return {"status": "INFRA_ERROR"}

        declare = b"DECLARE hireos_c NO SCROLL CURSOR FOR " + query.encode("utf-8")
        res = raw.exec_params(declare, [])
        if res.status != pq.ExecStatus.COMMAND_OK:
            return _sql_failure(res, started)

        res = raw.exec_params(("FETCH FORWARD %d FROM hireos_c" % (limits["maxRows"] + 1)).encode(), [])
        if res.status != pq.ExecStatus.TUPLES_OK:
            return _sql_failure(res, started)

        columns = []
        for i in range(res.nfields):
            oid = res.ftype(i)
            kind = "number" if oid in NUMERIC_OIDS else "bool" if oid == BOOL_OID else "text"
            columns.append({"name": (res.fname(i) or b"").decode("utf-8", "replace")[:63], "type": kind})

        rows, size, truncated = [], 0, False
        row_limit = res.ntuples > limits["maxRows"]
        for r in range(min(res.ntuples, limits["maxRows"])):
            row = []
            for c in range(res.nfields):
                value = res.get_value(r, c)
                if value is None:
                    row.append(None)
                    continue
                text = value.decode("utf-8", "replace")
                size += len(value)
                row.append(text == "t" if columns[c]["type"] == "bool" else text)
            if size > limits["maxResultBytes"]:
                truncated = True
                break
            rows.append(row)
        runtime_ms = int((time.monotonic() - started) * 1000)
        return {
            "status": "ROW_LIMIT" if (row_limit or truncated) else "OK",
            "columns": columns,
            "rows": rows,
            "rowLimitExceeded": row_limit,
            "resultTruncated": truncated,
            "runtimeMs": runtime_ms,
        }
    except psycopg.Error:
        return {"status": "INFRA_ERROR"}
    finally:
        watchdog.cancel()
        try:
            conn.pgconn.exec_(b"ROLLBACK")
        except Exception:
            pass
        conn.close()


def _cancel(conn):
    try:
        conn.cancel()
    except Exception:
        pass


def _sql_failure(res, started):
    state, message = _error(res)
    runtime_ms = int((time.monotonic() - started) * 1000)
    if state == "57014":
        return {"status": "TIMEOUT", "runtimeMs": runtime_ms}
    if state == "42601" and "DECLARE" not in message:
        message = message + " (only a single read query — SELECT / WITH / VALUES / TABLE — is allowed)"
    return {"status": "SQL_ERROR", "sqlState": state, "error": message, "runtimeMs": runtime_ms}
