/**
 * Every curated task must be solvable and correctly graded in the REAL sandbox:
 * reference solutions pass every visible + hidden test in both languages, SQL
 * reference queries reproduce the expected datasets, and the displayed sample
 * data matches the loaded dataset.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { runnerAvailable, signedPost, runSql } from "./helpers";
import { CODING_TASKS, SQL_TASKS } from "../../src/lib/practical/tasks";
import { compareSqlDatasets, evaluateCodingRun, evaluateSqlSubmission } from "../../src/lib/practical/evaluate";
import type { CodingLanguage } from "../../src/lib/practical/types";

const REFERENCE: Record<string, Record<CodingLanguage, string>> = {
  "coding-balanced-brackets": {
    python: `import sys
s = sys.stdin.readline().rstrip("\\n")
pairs = {")": "(", "]": "[", "}": "{"}
st = []
ok = True
for ch in s:
    if ch in "([{":
        st.append(ch)
    elif ch in pairs:
        if not st or st.pop() != pairs[ch]:
            ok = False
            break
print("YES" if ok and not st else "NO")
`,
    javascript: `const s = (require("fs").readFileSync(0, "utf8").split("\\n")[0]) || "";
const pairs = { ")": "(", "]": "[", "}": "{" };
const st = [];
let ok = true;
for (const ch of s) {
  if ("([{".includes(ch)) st.push(ch);
  else if (pairs[ch]) { if (st.pop() !== pairs[ch]) { ok = false; break; } }
}
console.log(ok && st.length === 0 ? "YES" : "NO");
`,
  },
  "coding-merge-intervals": {
    python: `import sys
data = sys.stdin.read().split()
n = int(data[0]) if data else 0
iv = sorted((int(data[1 + 2 * i]), int(data[2 + 2 * i])) for i in range(n))
out = []
for a, b in iv:
    if out and a <= out[-1][1]:
        out[-1][1] = max(out[-1][1], b)
    else:
        out.append([a, b])
sys.stdout.write("\\n".join(f"{a} {b}" for a, b in out) + ("\\n" if out else ""))
`,
    javascript: `const d = require("fs").readFileSync(0, "utf8").split(/\\s+/).filter(Boolean).map(Number);
const n = d[0] || 0;
const iv = [];
for (let i = 0; i < n; i++) iv.push([d[1 + 2 * i], d[2 + 2 * i]]);
iv.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
const out = [];
for (const [a, b] of iv) {
  const last = out[out.length - 1];
  if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
}
if (out.length) console.log(out.map(([a, b]) => a + " " + b).join("\\n"));
`,
  },
  "coding-grid-shortest-path": {
    python: `import sys
from collections import deque
lines = sys.stdin.read().split("\\n")
R, C = map(int, lines[0].split())
g = lines[1:1 + R]
for r in range(R):
    for c in range(C):
        if g[r][c] == "S":
            s = (r, c)
        elif g[r][c] == "E":
            e = (r, c)
dist = [[-1] * C for _ in range(R)]
dist[s[0]][s[1]] = 0
q = deque([s])
ans = -1
while q:
    r, c = q.popleft()
    if (r, c) == e:
        ans = dist[r][c]
        break
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < R and 0 <= nc < C and dist[nr][nc] == -1 and g[nr][nc] != "#":
            dist[nr][nc] = dist[r][c] + 1
            q.append((nr, nc))
print(ans)
`,
    javascript: `const lines = require("fs").readFileSync(0, "utf8").split("\\n");
const [R, C] = lines[0].split(" ").map(Number);
const g = lines.slice(1, 1 + R);
let s = 0, e = 0;
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { if (g[r][c] === "S") s = r * C + c; if (g[r][c] === "E") e = r * C + c; }
const dist = new Int32Array(R * C).fill(-1); const q = new Int32Array(R * C); let h = 0, t = 0;
dist[s] = 0; q[t++] = s; let ans = -1;
while (h < t) {
  const cur = q[h++]; if (cur === e) { ans = dist[cur]; break; }
  const r = Math.floor(cur / C), c = cur % C;
  for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= R || nc >= C) continue;
    const nx = nr * C + nc;
    if (dist[nx] !== -1 || g[nr][nc] === "#") continue;
    dist[nx] = dist[cur] + 1; q[t++] = nx;
  }
}
console.log(ans);
`,
  },
};

const SQL_REFERENCE: Record<string, string> = {
  "sql-customers-per-city":
    "SELECT city, COUNT(*) AS customer_count FROM customers WHERE city IS NOT NULL GROUP BY city ORDER BY customer_count DESC, city ASC",
  "sql-revenue-by-category":
    "SELECT p.category, ROUND(SUM(p.price * oi.quantity), 2) AS revenue FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE o.status = 'COMPLETED' GROUP BY p.category ORDER BY revenue DESC",
  "sql-top-customer-per-city":
    "WITH rev AS (SELECT c.id, c.name, c.city, SUM(p.price * oi.quantity) AS total FROM customers c JOIN orders o ON o.customer_id = c.id AND o.status = 'COMPLETED' JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE c.city IS NOT NULL GROUP BY c.id, c.name, c.city), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY city ORDER BY total DESC, id ASC) AS rn FROM rev) SELECT city, name AS customer_name, ROUND(total, 2) AS total_revenue FROM ranked WHERE rn = 1 ORDER BY total_revenue DESC",
};

before(async () => {
  assert.ok(await runnerAvailable(), "sandbox runner is not running — start it with `npm run sandbox:runner`");
});

describe("coding tasks are solvable and graded correctly in the real sandbox", () => {
  for (const task of CODING_TASKS) {
    for (const language of task.languages) {
      it(`${task.key} — ${language} reference passes all ${task.visibleTests.length + task.hiddenTests.length} tests`, async () => {
        const tests = [
          ...task.visibleTests.map((c) => ({ case: c, visible: true })),
          ...task.hiddenTests.map((c) => ({ case: c, visible: false })),
        ];
        const r = await signedPost("/v1/code/execute", {
          language,
          source: REFERENCE[task.key]![language],
          tests: tests.map((t) => ({ id: t.case.id, input: t.case.input })),
          limits: task.limits,
        });
        assert.equal(r.status, 200);
        const evaluated = evaluateCodingRun(task, tests, r.body);
        const failing = evaluated.result.tests.filter((t) => t.outcome !== "PASSED");
        assert.deepEqual(failing, [], JSON.stringify(failing));
        assert.equal(evaluated.result.passed, tests.length);
      });
    }
  }

  it("a wrong solution fails hidden tests without exposing them", async () => {
    const task = CODING_TASKS[0]!;
    const tests = [
      ...task.visibleTests.map((c) => ({ case: c, visible: true })),
      ...task.hiddenTests.map((c) => ({ case: c, visible: false })),
    ];
    const r = await signedPost("/v1/code/execute", {
      language: "python",
      source: "print('YES')\n",
      tests: tests.map((t) => ({ id: t.case.id, input: t.case.input })),
      limits: task.limits,
    });
    const evaluated = evaluateCodingRun(task, tests, r.body);
    assert.ok(evaluated.result.passed > 0 && evaluated.result.failed > 0);
    assert.ok(evaluated.visibleDetail.every((d) => task.visibleTests.some((v) => v.id === d.id)));
  });
});

describe("SQL tasks reproduce expected datasets in the real sandbox", () => {
  for (const task of SQL_TASKS) {
    it(`${task.key} — reference query is graded correct`, async () => {
      const r = await runSql(task.key, SQL_REFERENCE[task.key]!, task.limits);
      assert.equal(r.body?.status, "OK", JSON.stringify(r.body));
      const result = evaluateSqlSubmission(task, r.body);
      assert.equal(result.correct, true, JSON.stringify({ result, rows: r.body.rows }));
    });

    it(`${task.key} — displayed sample data matches the loaded dataset`, async () => {
      for (const sample of task.sampleData) {
        const r = await runSql(task.key, `SELECT ${sample.columns.join(", ")} FROM ${sample.table} ORDER BY 1, 2 LIMIT ${sample.rows.length}`);
        assert.equal(r.body?.status, "OK");
        const cmp = compareSqlDatasets(
          { columns: sample.columns, rows: sample.rows },
          { columns: r.body.columns.map((c: any) => c.name), rows: r.body.rows },
          { orderMatters: true, checkColumnNames: true, numericScale: 2 },
        );
        assert.equal(cmp.correct, true, `${sample.table}: ${JSON.stringify(cmp)}`);
      }
    });
  }

  it("wrong and wrongly-ordered answers are graded incorrect where order matters", async () => {
    const task = SQL_TASKS[0]!;
    const wrongOrder = await runSql(task.key, "SELECT city, COUNT(*) FROM customers WHERE city IS NOT NULL GROUP BY city ORDER BY city");
    const r1 = evaluateSqlSubmission(task, wrongOrder.body);
    assert.equal(r1.correct, false);
    assert.equal(r1.mismatch, "ORDER");
    const withNull = await runSql(task.key, "SELECT city, COUNT(*) FROM customers GROUP BY city ORDER BY 2 DESC, 1");
    assert.equal(evaluateSqlSubmission(task, withNull.body).correct, false);
  });
});
