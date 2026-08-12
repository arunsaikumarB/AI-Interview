import fs from "node:fs";
import { execSync } from "node:child_process";

const cookieFile = `${process.env.TEMP || "/tmp"}/aros-verify.cookies`;
const loginBody = `${process.env.TEMP || "/tmp"}/aros-login.json`;
fs.writeFileSync(
  loginBody,
  JSON.stringify({ email: "recruiter@local.dev", password: "password123" }),
);

function curl(args) {
  return execSync(`curl.exe ${args}`, { encoding: "utf8" });
}

curl(
  `-s -c "${cookieFile}" -b "${cookieFile}" -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" --data-binary "@${loginBody}" -o NUL`,
);

const dash = curl(`-s -b "${cookieFile}" http://localhost:3000/dashboard`);
const nums = [...dash.matchAll(/tabular-nums text-slate-900">(\d+)</g)].map(
  (m) => m[1],
);

const checks = {
  greeting: /Good (morning|afternoon|evening), Recruiter/.test(dash),
  noOllama: !/Ollama/.test(dash),
  needsAttention: /Needs Attention/.test(dash),
  recent: /Recent Interviews/.test(dash),
  advisory: /advisory/.test(dash),
  recruiterDecides: /recruiter decides/i.test(dash),
  navJobsCandidates: /Jobs &amp; Candidates|Jobs & Candidates/.test(dash),
  navInterviewLinks: /Interview Links/.test(dash),
  navTalentPool: /Talent Pool/.test(dash),
  navSettings: />Settings</.test(dash),
  noTopPipeline: !/>Pipeline<\/a>/.test(dash) || /RecruitingSubnav/.test(dash),
  metricNums: nums,
};

function firstStatus(path) {
  const headers = curl(`-si -b "${cookieFile}" "http://localhost:3000${path}"`);
  const status = headers.split("\n")[0]?.trim();
  const loc = headers
    .split("\n")
    .find((l) => l.toLowerCase().startsWith("location:"))
    ?.trim();
  return { status, loc: loc || "" };
}

const routes = [
  "/dashboard",
  "/dashboard/recruiting",
  "/dashboard/jobs",
  "/dashboard/candidates",
  "/dashboard/pipeline",
  "/dashboard/pipeline?stage=SCREENING",
  "/dashboard/interview-links",
  "/dashboard/talent",
  "/dashboard/analytics",
  "/dashboard/settings",
  "/dashboard/settings/templates",
  "/dashboard/admin",
];

const routeResults = Object.fromEntries(
  routes.map((p) => [p, firstStatus(p)]),
);

// Candidate probe — pick first CANDIDATE email from DB if present
let candidateResult = "no candidate user in seed";
try {
  const emails = execSync(
    `docker compose --env-file .env.docker exec -T postgres psql -U ats -d ai_recruitment_os -t -A -c "SELECT email FROM \\"User\\" WHERE role='CANDIDATE' LIMIT 1;"`,
    { encoding: "utf8", cwd: process.cwd() },
  ).trim();
  if (emails) {
    const candCookie = `${process.env.TEMP || "/tmp"}/aros-cand.cookies`;
    const candBody = `${process.env.TEMP || "/tmp"}/aros-cand.json`;
    fs.writeFileSync(
      candBody,
      JSON.stringify({ email: emails, password: "password123" }),
    );
    const loginOut = curl(
      `-s -c "${candCookie}" -b "${candCookie}" -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" --data-binary "@${candBody}"`,
    );
    if (loginOut.includes('"role":"CANDIDATE"')) {
      candidateResult = firstStatus("/dashboard");
      // overwrite path for clarity — use cand cookies
      const headers = curl(
        `-si -b "${candCookie}" http://localhost:3000/dashboard`,
      );
      candidateResult = {
        email: emails,
        status: headers.split("\n")[0]?.trim(),
        loc:
          headers
            .split("\n")
            .find((l) => l.toLowerCase().startsWith("location:"))
            ?.trim() || "",
      };
    } else {
      candidateResult = { email: emails, login: loginOut.slice(0, 200) };
    }
  }
} catch (e) {
  candidateResult = String(e.message || e);
}

console.log(
  JSON.stringify(
    {
      dbExpected: {
        candidates: 16,
        openJobs: 4,
        liveInterviews: 4,
        selected: 1,
      },
      dashboardMetricNums: nums,
      checks,
      routes: routeResults,
      candidateDashboard: candidateResult,
    },
    null,
    2,
  ),
);
