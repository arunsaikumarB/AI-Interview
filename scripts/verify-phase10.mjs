/**
 * Phase 10 verify — funnel vs board, finite time metrics, AI-vs-human n, no PII leaks.
 */
import { SignJWT } from "jose";
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  const path = ".env";
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv();

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = process.env.AUTH_COOKIE_NAME ?? "aros_session";

async function mintRecruiter() {
  // login is simpler
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "recruiter@local.dev",
      password: "password123",
    }),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  const cookie = raw.length
    ? raw.map((c) => c.split(";")[0]).join("; ")
    : (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!res.ok) throw new Error("login failed");
  return cookie;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const cookie = await mintRecruiter();
  const board = await (
    await fetch(`${BASE}/api/applications/board`, { headers: { Cookie: cookie } })
  ).json();
  const analytics = await (
    await fetch(`${BASE}/api/analytics`, { headers: { Cookie: cookie } })
  ).json();

  const boardCounts = {};
  for (const stage of board.stages ?? []) {
    boardCounts[stage] = (board.columns?.[stage] ?? []).length;
  }
  for (const s of analytics.funnel.stages) {
    assert(
      s.count === (boardCounts[s.stage] ?? 0),
      `funnel ${s.stage}: analytics=${s.count} board=${boardCounts[s.stage]}`,
    );
  }
  console.log("PASS  funnel matches board tallies");

  for (const key of ["timeToShortlist", "timeToHire"]) {
    const m = analytics.timeMetrics[key];
    assert(Number.isFinite(m.n), `${key}.n not finite`);
    if (m.n === 0) {
      assert(m.medianDays === null && m.avgDays === null, `${key} empty must be null`);
    } else {
      assert(Number.isFinite(m.medianDays) && Number.isFinite(m.avgDays), `${key} days`);
      assert(![Infinity, -Infinity].includes(m.medianDays), `${key} median inf`);
    }
  }
  console.log("PASS  time metrics finite / null-safe", analytics.timeMetrics);

  const avh = analytics.aiVsHuman;
  assert(typeof avh.n === "number" && avh.n >= 0, "aiVsHuman.n");
  const sum =
    avh.matrix.aiPositiveHumanSelected +
    avh.matrix.aiPositiveHumanRejected +
    avh.matrix.aiNegativeHumanSelected +
    avh.matrix.aiNegativeHumanRejected;
  assert(sum === avh.n, "matrix sum === n");
  assert(
    !JSON.stringify(analytics).includes("SECRET_EVAL") &&
      !/"reasoning"\s*:/.test(JSON.stringify(analytics)),
    "no reasoning field in analytics JSON",
  );
  // Alex (YES, non-terminal) must not invent a matrix pair
  console.log("PASS  AI vs human", {
    n: avh.n,
    agreementRate: avh.agreementRate,
    neutralMaybe: avh.neutralMaybe,
    matrix: avh.matrix,
    disagreements: avh.disagreements.length,
  });

  // Interviewer → 403
  const iv = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "interviewer@local.dev",
      password: "password123",
    }),
  });
  const ivCookie = (iv.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ") || (iv.headers.get("set-cookie") ?? "").split(";")[0];
  const denied = await fetch(`${BASE}/api/analytics`, {
    headers: { Cookie: ivCookie },
  });
  assert(denied.status === 403, `interviewer expected 403 got ${denied.status}`);
  console.log("PASS  INTERVIEWER → 403");

  // Candidate → 403
  const secret = process.env.AUTH_SECRET;
  if (secret) {
    const token = await new SignJWT({
      email: "cand@test",
      name: "C",
      role: "CANDIDATE",
      organizationId: null,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("fake-cand")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    const cRes = await fetch(`${BASE}/api/analytics`, {
      headers: { Cookie: `${COOKIE}=${token}` },
    });
    assert(cRes.status === 403, `candidate expected 403 got ${cRes.status}`);
    console.log("PASS  CANDIDATE → 403");
  }

  console.log("\nPhase 10 verify OK");
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
