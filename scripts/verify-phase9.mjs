/**
 * Phase 9 verification script — run against local Next.js (:3000).
 */
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) {
    return raw.map((c) => c.split(";")[0]).join("; ");
  }
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  return { res, data, cookie: cookieFrom(res) };
}

async function main() {
  const results = [];
  const email = `phase9-${Date.now()}@example.com`;
  const resumePath = join(tmpdir(), `phase9-resume-${Date.now()}.txt`);
  writeFileSync(
    resumePath,
    "Jane Phase Nine\nSoftware Engineer\nSkills: TypeScript, PostgreSQL, Docker\n",
  );

  // Jobs list
  const careers = await fetch(`${BASE}/api/careers`);
  const careersJson = await careers.json();
  const jobId = careersJson.jobs?.[0]?.id;
  if (!jobId) throw new Error("No OPEN jobs for careers apply test");
  results.push(["careers list OPEN jobs", careers.ok]);

  // Apply without account
  const fd = new FormData();
  fd.set("jobId", jobId);
  fd.set("firstName", "Jane");
  fd.set("lastName", "PhaseNine");
  fd.set("email", email);
  fd.set("phone", "+1 555 0100");
  fd.set("location", "Remote");
  fd.set("coverNote", "Excited to apply");
  fd.set("website", ""); // honeypot empty
  const blob = new Blob(
    ["Jane Phase Nine\nSoftware Engineer\nSkills: TypeScript, PostgreSQL, Docker\n"],
    { type: "text/plain" },
  );
  fd.set("resume", blob, "resume.txt");

  const apply1 = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: fd });
  const apply1Json = await apply1.json();
  results.push([
    "apply without account → 201",
    apply1.status === 201 && apply1Json.applicationId,
  ]);

  // Duplicate apply
  const fd2 = new FormData();
  fd2.set("jobId", jobId);
  fd2.set("firstName", "Jane");
  fd2.set("lastName", "PhaseNine");
  fd2.set("email", email);
  fd2.set("resume", blob, "resume.txt");
  const apply2 = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: fd2 });
  const apply2Json = await apply2.json();
  results.push([
    "duplicate apply → 409 alreadyApplied",
    apply2.status === 409 && apply2Json.alreadyApplied === true,
  ]);

  // Honeypot drop
  const fdH = new FormData();
  fdH.set("jobId", jobId);
  fdH.set("firstName", "Bot");
  fdH.set("lastName", "Spam");
  fdH.set("email", `bot-${Date.now()}@example.com`);
  fdH.set("website", "https://spam.example");
  fdH.set("resume", blob, "resume.txt");
  const honeypot = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: fdH });
  const honeypotJson = await honeypot.json();
  results.push([
    "honeypot silently dropped",
    honeypot.ok && honeypotJson.dropped === true,
  ]);

  // Candidate account apply on another job if available
  const job2 = careersJson.jobs?.[1]?.id ?? jobId;
  const candEmail = `portal-${Date.now()}@example.com`;
  const fdA = new FormData();
  fdA.set("jobId", job2);
  fdA.set("firstName", "Pat");
  fdA.set("lastName", "Portal");
  fdA.set("email", candEmail);
  fdA.set("password", "portalpass99");
  fdA.set("resume", blob, "resume.txt");
  const applyAcct = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: fdA });
  const applyAcctJson = await applyAcct.json();
  results.push([
    "apply with account → created",
    applyAcct.status === 201 && applyAcctJson.accountCreated === true,
  ]);

  const candLogin = await login(candEmail, "portalpass99");
  results.push(["candidate login", candLogin.res.ok]);

  const portalApps = await fetch(`${BASE}/api/portal/applications`, {
    headers: { Cookie: candLogin.cookie },
  });
  const portalJson = await portalApps.json();
  const portalStr = JSON.stringify(portalJson);
  const leak =
    /score|screening|evaluation|aiEvaluation|reasoning|recommendation/i.test(
      portalStr,
    );
  const underReview = JSON.stringify(portalJson.applications ?? []).includes(
    "Under review",
  ) || JSON.stringify(portalJson.applications ?? []).includes("Received");
  results.push(["portal apps load", portalApps.ok]);
  results.push(["portal JSON has no scores/eval fields", !leak]);
  results.push(["portal shows candidate-safe stage label", underReview]);

  // Candidate JWT → 403 on staff endpoints
  const staffEndpoints = [
    "/api/talent/search",
    "/api/candidates",
    "/api/interviews/seed-does-not-exist",
  ];
  for (const path of staffEndpoints) {
    const method = path.includes("talent") ? "POST" : "GET";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Cookie: candLogin.cookie,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify({ query: "test" }) : undefined,
    });
    results.push([`candidate JWT 403 on ${path}`, res.status === 403]);
  }

  // Recruiter blocked from admin
  const rec = await login("recruiter@local.dev", "password123");
  const adminUsers = await fetch(`${BASE}/api/admin/users`, {
    headers: { Cookie: rec.cookie },
  });
  results.push(["RECRUITER 403 on /api/admin/users", adminUsers.status === 403]);

  // Deactivate + login fail (use a throwaway created by admin)
  const admin = await login("admin@local.dev", "password123");
  const create = await fetch(`${BASE}/api/admin/users`, {
    method: "POST",
    headers: {
      Cookie: admin.cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Temp Deactivate",
      email: `temp-deact-${Date.now()}@local.dev`,
      role: "RECRUITER",
    }),
  });
  const createJson = await create.json();
  results.push(["admin create staff user", create.ok && createJson.temporaryPassword]);

  if (createJson.user?.id) {
    await fetch(`${BASE}/api/admin/users/${createJson.user.id}`, {
      method: "PATCH",
      headers: {
        Cookie: admin.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive: false }),
    });
    const deadLogin = await login(
      createJson.user.email,
      createJson.temporaryPassword,
    );
    results.push([
      "deactivated user cannot log in",
      deadLogin.res.status === 401,
    ]);
  }

  // Staff pipeline has the guest application
  const staffApps = await fetch(`${BASE}/api/applications`, {
    headers: { Cookie: admin.cookie },
  });
  const staffAppsJson = await staffApps.json();
  const found = (staffAppsJson.applications ?? []).some(
    (a) => a.id === apply1Json.applicationId,
  );
  results.push(["guest application visible in staff pipeline", found]);

  try {
    unlinkSync(resumePath);
  } catch {
    /* ignore */
  }

  console.log("\nPhase 9 verification\n");
  let failed = 0;
  for (const [name, ok] of results) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
