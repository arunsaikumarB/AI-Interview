import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AssessmentEngineService } from "../../src/lib/assessment/service";
import type { JobInput } from "../../src/lib/assessment/types";
import {
  assertTransition,
  canTransition,
  isAttemptExpired,
  isEditable,
  isTerminalStatus,
  PRACTICAL_STATUSES,
  PracticalLifecycleError,
  SUBMIT_GRACE_MS,
} from "../../src/lib/practical/lifecycle";
import {
  AssignInputSchema,
  CODING_HARD_LIMITS,
  CodingRunInputSchema,
  DraftInputSchema,
  SqlRunInputSchema,
  type CodingTask,
  type SqlTask,
} from "../../src/lib/practical/types";
import { allPracticalTasks, candidateTaskView, CODING_TASKS, pickTask, SQL_TASKS } from "../../src/lib/practical/tasks";
import { compareSqlDatasets, evaluateCodingRun, evaluateSqlSubmission, normalizeOutput } from "../../src/lib/practical/evaluate";
import { difficultyBand, selectPracticalTask } from "../../src/lib/practical/select";
import { callRunner, callRunnerWithRetry, signRunnerRequest } from "../../src/lib/practical/runner-client";
import { ACCESS_TOKEN_RE, hashAccessToken, newAccessToken } from "../../src/lib/practical/token";
import { execStatusForResult, practicalAuditPayload } from "../../src/lib/practical/service";
import { humanTimelineTitle } from "../../src/lib/candidate-detail-ui";

const coding = CODING_TASKS[0] as CodingTask;
const sql = SQL_TASKS[0] as SqlTask;

describe("practical lifecycle", () => {
  it("follows NOT_STARTED → STARTED → IN_PROGRESS → SUBMITTED → EXECUTING → COMPLETED", () => {
    assert.ok(canTransition("NOT_STARTED", "STARTED", "CANDIDATE"));
    assert.ok(canTransition("STARTED", "IN_PROGRESS", "CANDIDATE"));
    assert.ok(canTransition("IN_PROGRESS", "SUBMITTED", "CANDIDATE"));
    assert.ok(canTransition("SUBMITTED", "EXECUTING", "EXECUTOR"));
    assert.ok(canTransition("EXECUTING", "COMPLETED", "EXECUTOR"));
  });

  it("never lets the candidate or staff set execution outcomes", () => {
    for (const to of ["EXECUTING", "COMPLETED", "EXECUTION_FAILED", "TIMEOUT"] as const) {
      for (const from of PRACTICAL_STATUSES) {
        assert.equal(canTransition(from, to, "CANDIDATE"), false, `${from}→${to} by candidate`);
        assert.equal(canTransition(from, to, "STAFF"), false, `${from}→${to} by staff`);
      }
    }
    assert.throws(() => assertTransition("EXECUTING", "COMPLETED", "CANDIDATE"), PracticalLifecycleError);
    assert.throws(() => assertTransition("IN_PROGRESS", "PASSED", "EXECUTOR"), PracticalLifecycleError);
  });

  it("terminal states are final and a submitted attempt cannot be cancelled or reopened", () => {
    for (const s of ["COMPLETED", "EXECUTION_FAILED", "TIMEOUT", "CANCELLED"] as const) {
      assert.ok(isTerminalStatus(s));
      for (const to of PRACTICAL_STATUSES) {
        for (const actor of ["CANDIDATE", "STAFF", "EXECUTOR", "SYSTEM"] as const) {
          assert.equal(canTransition(s, to, actor), false);
        }
      }
    }
    assert.equal(canTransition("SUBMITTED", "CANCELLED", "STAFF"), false);
    assert.equal(canTransition("SUBMITTED", "IN_PROGRESS", "CANDIDATE"), false);
    assert.ok(isEditable("IN_PROGRESS"));
    assert.ok(!isEditable("SUBMITTED"));
  });

  it("attempt expiry honours the time limit plus a small grace period", () => {
    const start = new Date("2026-09-29T10:00:00Z");
    const end = start.getTime() + 30 * 60_000;
    assert.equal(isAttemptExpired(start, 30, new Date(end + SUBMIT_GRACE_MS - 1)), false);
    assert.equal(isAttemptExpired(start, 30, new Date(end + SUBMIT_GRACE_MS + 1)), true);
    assert.equal(isAttemptExpired(null, 30, new Date(end * 2)), false);
  });
});

describe("practical contracts — browser input is strict", () => {
  it("rejects attempts to send hidden tests, limits, competency, difficulty or expected results", () => {
    for (const extra of [
      { hiddenTests: [] },
      { limits: { perTestTimeoutMs: 999999 } },
      { competency: "x" },
      { difficulty: "EASY" },
      { expectedResult: {} },
      { score: 100 },
      { status: "COMPLETED" },
    ]) {
      assert.equal(CodingRunInputSchema.safeParse({ language: "python", source: "print(1)", ...extra }).success, false);
      assert.equal(SqlRunInputSchema.safeParse({ language: "postgresql", source: "SELECT 1", ...extra }).success, false);
      assert.equal(DraftInputSchema.safeParse({ language: "python", source: "x", ...extra }).success, false);
      assert.equal(AssignInputSchema.safeParse({ type: "CODING", ...extra }).success, false);
    }
  });

  it("rejects unsupported languages, NUL bytes, empty and oversized source", () => {
    assert.equal(CodingRunInputSchema.safeParse({ language: "bash", source: "ls" }).success, false);
    assert.equal(CodingRunInputSchema.safeParse({ language: "python", source: "print(1)\u0000" }).success, false);
    assert.equal(CodingRunInputSchema.safeParse({ language: "python", source: "   " }).success, false);
    assert.equal(
      CodingRunInputSchema.safeParse({ language: "python", source: "#".repeat(CODING_HARD_LIMITS.sourceMaxBytes + 1) }).success,
      false,
    );
    assert.equal(CodingRunInputSchema.safeParse({ language: "python", source: "é".repeat(CODING_HARD_LIMITS.sourceMaxBytes / 2 + 1) }).success, false);
    assert.equal(SqlRunInputSchema.safeParse({ language: "python", source: "SELECT 1" }).success, false);
    assert.equal(AssignInputSchema.safeParse({ type: "SYSTEM_DESIGN" }).success, false);
  });
});

describe("practical task library", () => {
  it("has unique versioned keys and sane limits within the hard caps", () => {
    const keys = new Set<string>();
    for (const t of allPracticalTasks()) {
      const k = `${t.key}@${t.version}`;
      assert.ok(!keys.has(k), `duplicate ${k}`);
      keys.add(k);
      if (t.kind === "CODING") {
        assert.ok(t.visibleTests.length + t.hiddenTests.length <= CODING_HARD_LIMITS.maxTests);
        assert.ok(t.limits.perTestTimeoutMs <= CODING_HARD_LIMITS.perTestTimeoutMs);
        assert.ok(t.hiddenTests.length > 0);
        const ids = [...t.visibleTests, ...t.hiddenTests].map((c) => c.id);
        assert.equal(new Set(ids).size, ids.length);
      }
    }
  });

  it("candidate view never contains hidden tests or the expected SQL result", () => {
    for (const t of allPracticalTasks()) {
      const view = JSON.stringify(candidateTaskView(t));
      assert.ok(!view.includes("hiddenTests"));
      assert.ok(!view.includes("expectedResult"));
      if (t.kind === "CODING") {
        for (const h of t.hiddenTests) {
          if (h.input.length >= 8) assert.ok(!view.includes(JSON.stringify(h.input).slice(1, -1)), `${t.key} leaks ${h.id}`);
        }
      } else {
        const expectedRows = JSON.stringify(t.expectedResult.rows);
        assert.ok(!view.includes(expectedRows));
      }
    }
  });

  it("picks the exact difficulty or the nearest available task", () => {
    assert.equal(pickTask("CODING", "EASY")?.difficulty, "EASY");
    assert.equal(pickTask("SQL", "HARD")?.difficulty, "HARD");
    assert.equal(difficultyBand(1), "EASY");
    assert.equal(difficultyBand(3), "MEDIUM");
    assert.equal(difficultyBand(5), "HARD");
  });
});

describe("deterministic coding evaluation", () => {
  const tests = [
    ...coding.visibleTests.map((c) => ({ case: c, visible: true })),
    ...coding.hiddenTests.map((c) => ({ case: c, visible: false })),
  ];

  it("counts passes by exact normalised output and returns the required result shape", () => {
    const response = {
      status: "OK" as const,
      memoryMb: 12.5,
      tests: tests.map((t, i) => ({
        id: t.case.id,
        outcome: "OK" as const,
        stdout: i === 0 ? "definitely wrong\n" : `${t.case.expected}\r\n\n`,
        stderrTail: "",
        runtimeMs: 10,
      })),
    };
    const { result, visibleDetail } = evaluateCodingRun(coding, tests, response);
    assert.equal(result.total, tests.length);
    assert.equal(result.passed, tests.length - 1);
    assert.equal(result.failed, 1);
    assert.equal(result.runtimeMs, 10 * tests.length);
    assert.equal(result.memoryMb, 12.5);
    for (const key of ["status", "passed", "failed", "total", "runtimeMs", "memoryMb", "compileError", "timedOut"]) {
      assert.ok(key in result, key);
    }
    assert.equal(visibleDetail.length, coding.visibleTests.length);
    assert.ok(!("score" in result) && !("recommendation" in result));
  });

  it("maps compile errors, whole-run timeouts and resource violations without fabricating passes", () => {
    const compile = evaluateCodingRun(coding, tests, { status: "COMPILE_ERROR", compileError: "SyntaxError: bad" });
    assert.equal(compile.result.status, "COMPILE_ERROR");
    assert.equal(compile.result.passed, 0);
    assert.equal(compile.compileErrorMessage, "SyntaxError: bad");
    const timeout = evaluateCodingRun(coding, tests, { status: "TIMEOUT" });
    assert.equal(timeout.result.timedOut, true);
    assert.equal(timeout.result.passed, 0);
    const mem = evaluateCodingRun(coding, tests, { status: "RESOURCE_VIOLATION", violation: "MEMORY" });
    assert.equal(mem.result.resourceViolation, "MEMORY");
    const infra = evaluateCodingRun(coding, tests, { status: "INFRA_ERROR" });
    assert.equal(infra.result.status, "EXECUTION_FAILED");
    assert.equal(execStatusForResult(infra.result), "EXECUTION_FAILED");
    assert.equal(execStatusForResult(compile.result), "COMPLETED");
    assert.equal(execStatusForResult(timeout.result), "TIMEOUT");
  });

  it("a test the runner did not report is NOT_RUN, never passed", () => {
    const { result } = evaluateCodingRun(coding, tests, { status: "OK", memoryMb: null, tests: [] });
    assert.equal(result.passed, 0);
    assert.ok(result.tests.every((t) => t.outcome === "NOT_RUN"));
  });

  it("normalises CRLF and trailing whitespace only", () => {
    assert.equal(normalizeOutput("a  \r\nb\t\n\n"), "a\nb");
    assert.notEqual(normalizeOutput(" a"), normalizeOutput("a"));
  });
});

describe("SQL dataset comparison — results, not SQL text", () => {
  const cmp = { orderMatters: false, checkColumnNames: false, numericScale: 2 };
  const expected = { columns: ["city", "n"], rows: [["Pune", 3], ["Delhi", 2], [null, 1]] as (string | number | null)[][] };

  it("accepts equivalent datasets with different column names, numeric text and order (when order is irrelevant)", () => {
    const actual = { columns: ["c", "count"], rows: [[null, "1"], ["Delhi", "2.000"], ["Pune", "3"]] };
    assert.deepEqual(compareSqlDatasets(expected, actual, cmp), { correct: true, mismatch: null });
  });

  it("distinguishes NULL from empty string, detects duplicates and wrong counts", () => {
    assert.equal(compareSqlDatasets(expected, { columns: ["a", "b"], rows: [["Pune", 3], ["Delhi", 2], ["", 1]] }, cmp).mismatch, "VALUES");
    assert.equal(
      compareSqlDatasets(expected, { columns: ["a", "b"], rows: [["Pune", 3], ["Pune", 3], [null, 1]] }, cmp).mismatch,
      "VALUES",
    );
    assert.equal(compareSqlDatasets(expected, { columns: ["a", "b"], rows: [["Pune", 3]] }, cmp).mismatch, "ROW_COUNT");
    assert.equal(compareSqlDatasets(expected, { columns: ["a"], rows: [["Pune"], ["Delhi"], [null]] }, cmp).mismatch, "COLUMN_COUNT");
  });

  it("enforces order only where the task says it matters", () => {
    const reversed = { columns: ["a", "b"], rows: [[null, 1], ["Delhi", 2], ["Pune", 3]] };
    assert.equal(compareSqlDatasets(expected, reversed, { ...cmp, orderMatters: true }).mismatch, "ORDER");
    assert.equal(compareSqlDatasets(expected, reversed, cmp).correct, true);
  });

  it("maps runner outcomes to evidence without a score", () => {
    const ok = evaluateSqlSubmission(sql, {
      status: "OK",
      columns: sql.expectedResult.columns.map((name) => ({ name, type: "text" as const })),
      rows: sql.expectedResult.rows.map((r) => r.map((c) => (c === null ? null : String(c)))),
      rowLimitExceeded: false,
      resultTruncated: false,
      runtimeMs: 4,
    });
    assert.equal(ok.correct, true);
    assert.equal(ok.passed, 1);
    const err = evaluateSqlSubmission(sql, { status: "SQL_ERROR", sqlState: "42601", error: "syntax error", runtimeMs: 1 });
    assert.equal(err.status, "SQL_ERROR");
    assert.equal(err.correct, false);
    const to = evaluateSqlSubmission(sql, { status: "TIMEOUT", runtimeMs: 3000 });
    assert.equal(to.timedOut, true);
    assert.equal(execStatusForResult(to), "TIMEOUT");
    assert.equal(execStatusForResult(err), "COMPLETED");
  });
});

describe("task selection from the V1 blueprint", () => {
  const job = (partial: Partial<JobInput>): JobInput => ({
    id: "job-sel",
    title: "Engineer",
    description: "",
    skills: [],
    experienceMin: 0,
    experienceMax: null,
    screeningCriteria: {},
    ...partial,
  });
  const candidate = { applicationId: "app-sel", name: "Test", resumeText: null, skills: [] };
  const analyst = job({
    title: "Data Analyst",
    description: "Requirements:\n- Strong SQL and PostgreSQL skills\n- Build dashboards and reports\n- Data analysis with Excel",
    skills: ["SQL", "Excel"],
    experienceMin: 2,
    experienceMax: 4,
  });
  const fullstack = job({
    title: "Full Stack Developer",
    description: "Requirements:\n- React and Node.js\n- PostgreSQL database design\n- REST APIs",
    skills: ["React", "Node.js", "PostgreSQL"],
    experienceMin: 3,
    experienceMax: 5,
  });

  it("requires application context", () => {
    const b = AssessmentEngineService.buildBlueprint({ job: analyst });
    assert.deepEqual(selectPracticalTask(b, "SQL"), { ok: false, reason: "NO_APPLICATION_CONTEXT" });
  });

  it("uses the blueprint competency and difficulty and records provenance", () => {
    const b = AssessmentEngineService.buildBlueprint({ job: analyst, candidate, now: new Date("2026-09-29T00:00:00Z") });
    const sel = selectPracticalTask(b, "SQL");
    assert.ok(sel.ok);
    if (!sel.ok) return;
    assert.equal(sel.task.kind, "SQL");
    assert.equal(sel.provenance.applicationId, "app-sel");
    assert.equal(sel.provenance.jobId, "job-sel");
    assert.equal(sel.provenance.engineVersion, b.engineVersion);
    assert.ok(sel.competency.length > 0);
    assert.equal(sel.difficulty, sel.task.difficulty);
  });

  it("a coding task on a SQL-heavy role evidences a programming competency, never SQL", () => {
    const b = AssessmentEngineService.buildBlueprint({ job: analyst, candidate });
    const sel = selectPracticalTask(b, "CODING");
    if (sel.ok) {
      assert.equal(sel.task.kind, "CODING");
      assert.ok(!/\bsql\b/i.test(sel.competency), `coding task mapped to ${sel.competency}`);
    } else {
      assert.equal(sel.reason, "NO_MATCHING_COMPETENCY");
    }
  });

  it("a coding task on a role with Python evidences Python, not SQL or Excel", () => {
    const b = AssessmentEngineService.buildBlueprint({
      job: { ...analyst, description: `${analyst.description}\n- Python scripting for data cleaning`, skills: ["SQL", "Excel", "Python"] },
      candidate,
    });
    const sel = selectPracticalTask(b, "CODING");
    assert.ok(sel.ok, JSON.stringify(sel));
    if (sel.ok) assert.match(sel.competency, /python/i);
  });

  it("maps a coding runtime to a JD technical competency when the recommendation differs", () => {
    const b = AssessmentEngineService.buildBlueprint({ job: fullstack, candidate });
    const sel = selectPracticalTask(b, "CODING");
    assert.ok(sel.ok);
    if (sel.ok) assert.equal(sel.task.kind, "CODING");
  });
});

describe("sandbox runner client", () => {
  const config = { url: "http://127.0.0.1:1", secret: "s".repeat(40) };

  it("signs ts.method.path.sha256(body) with HMAC-SHA256", () => {
    const body = '{"a":1}';
    const expected = crypto
      .createHmac("sha256", config.secret)
      .update(`123.POST./v1/code/execute.${crypto.createHash("sha256").update(body).digest("hex")}`)
      .digest("hex");
    assert.equal(signRunnerRequest(config.secret, "123", "POST", "/v1/code/execute", body), expected);
  });

  it("maps runner statuses and never throws", async () => {
    const reply = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });
    assert.deepEqual(await callRunner("/v1/code/execute", {}, { timeoutMs: 1000, config, fetchImpl: reply(503) }), { ok: false, error: "BUSY" });
    assert.deepEqual(await callRunner("/v1/code/execute", {}, { timeoutMs: 1000, config, fetchImpl: reply(401) }), { ok: false, error: "REJECTED" });
    assert.deepEqual(await callRunner("/v1/code/execute", {}, { timeoutMs: 1000, config, fetchImpl: reply(500) }), { ok: false, error: "UNAVAILABLE" });
    const boom = async () => {
      throw new Error("ECONNREFUSED");
    };
    assert.deepEqual(await callRunner("/v1/code/execute", {}, { timeoutMs: 1000, config, fetchImpl: boom }), { ok: false, error: "UNAVAILABLE" });
    assert.deepEqual(await callRunner("/v1/code/execute", {}, { timeoutMs: 1000, config: null }), { ok: false, error: "UNAVAILABLE" });
    const ok = await callRunner("/v1/code/execute", {}, { timeoutMs: 1000, config, fetchImpl: reply(200, { status: "OK" }) });
    assert.deepEqual(ok, { ok: true, data: { status: "OK" } });
  });

  it("R-3: retries infrastructure failures a bounded number of times, never candidate rejections", async () => {
    let calls = 0;
    const down = async () => {
      calls++;
      return new Response("{}", { status: 502 });
    };
    const res = await callRunnerWithRetry("/v1/code/execute", {}, { timeoutMs: 1000, config, fetchImpl: down, sleep: async () => {} });
    assert.equal(res.ok, false);
    assert.equal(calls, 3);
    assert.equal(res.attempts, 3);
    calls = 0;
    const rejected = async () => {
      calls++;
      return new Response("{}", { status: 400 });
    };
    await callRunnerWithRetry("/v1/code/execute", {}, { timeoutMs: 1000, config, fetchImpl: rejected, sleep: async () => {} });
    assert.equal(calls, 1);
  });
});

describe("tokens and audit", () => {
  it("tokens are 256-bit base64url and only the hash is persisted", () => {
    const { token, hash } = newAccessToken();
    assert.match(token, ACCESS_TOKEN_RE);
    assert.equal(hash, hashAccessToken(token));
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(newAccessToken().token, token);
  });

  it("audit payloads are advisory evidence flags and cannot be overridden", () => {
    const p = practicalAuditPayload("practical_assessment_completed", {
      assessmentId: "a1",
      advisoryOnly: false,
      noAtsStageChange: false,
      kind: "forged",
    });
    assert.equal(p.kind, "practical_assessment_completed");
    assert.equal(p.advisoryOnly, true);
    assert.equal(p.noAtsStageChange, true);
    assert.equal(p.noAiInput, true);
  });

  it("timeline shows readable practical titles and leaves other OTHER events unchanged", () => {
    assert.equal(humanTimelineTitle("OTHER", { kind: "practical_assessment_submitted" }), "Practical assessment submitted");
    assert.equal(humanTimelineTitle("OTHER", { kind: "plan_edited" }), "Update recorded");
    assert.equal(humanTimelineTitle("OTHER", null), "Update recorded");
  });
});
