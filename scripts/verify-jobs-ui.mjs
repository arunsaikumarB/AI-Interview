import fs from "node:fs";
import { execSync } from "node:child_process";

const cookieFile = `${process.env.TEMP || "/tmp"}/aros-jobs.cookies`;
const loginBody = `${process.env.TEMP || "/tmp"}/aros-jobs-login.json`;
fs.writeFileSync(
  loginBody,
  JSON.stringify({ email: "recruiter@local.dev", password: "password123" }),
);

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" });
}

function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try {
      const h = sh("curl.exe -s http://localhost:3000/api/health");
      if (h.includes('"ok":true') && h.includes('"database":{"ok":true}')) return;
    } catch {}
    execSync("powershell -Command Start-Sleep -Seconds 2");
  }
  throw new Error("app not healthy");
}

waitHealthy();
sh(
  `curl.exe -s -c "${cookieFile}" -b "${cookieFile}" -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" --data-binary "@${loginBody}" -o NUL`,
);

function get(path) {
  return sh(`curl.exe -s -b "${cookieFile}" "http://localhost:3000${path}"`);
}
function head(path) {
  const headers = sh(`curl.exe -si -b "${cookieFile}" "http://localhost:3000${path}"`);
  return {
    status: headers.split("\n")[0]?.trim(),
    loc:
      headers
        .split("\n")
        .find((l) => l.toLowerCase().startsWith("location:"))
        ?.trim() || "",
  };
}

const jobs = get("/dashboard/jobs");
const jobIdMatch = jobs.match(/href="\/dashboard\/jobs\/([^"]+)"/);
const jobId = jobIdMatch?.[1];

const candCookie = `${process.env.TEMP || "/tmp"}/aros-cand2.cookies`;
const candBody = `${process.env.TEMP || "/tmp"}/aros-cand2.json`;
fs.writeFileSync(
  candBody,
  JSON.stringify({ email: "candidate@local.dev", password: "password123" }),
);
sh(
  `curl.exe -s -c "${candCookie}" -b "${candCookie}" -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" --data-binary "@${candBody}" -o NUL`,
);
const candDash = sh(
  `curl.exe -si -b "${candCookie}" http://localhost:3000/dashboard`,
);

const apiCand = sh(
  `curl.exe -s -o NUL -w "%{http_code}" -b "${candCookie}" http://localhost:3000/api/candidates`,
);

console.log(
  JSON.stringify(
    {
      jobsHub: {
        title: /Jobs &amp; Candidates|Jobs & Candidates/.test(jobs),
        columns: /In Interview/.test(jobs) && /Selected/.test(jobs),
        noOllama: !/Ollama/.test(jobs),
        addJob: /Add Job/.test(jobs),
      },
      routes: {
        recruiting: head("/dashboard/recruiting"),
        jobs: head("/dashboard/jobs"),
        candidates: head("/dashboard/candidates"),
        pipeline: head("/dashboard/pipeline"),
        jobWorkspace: jobId
          ? head(`/dashboard/jobs/${jobId}`)
          : { status: "no job id" },
        jobPipelineTab: jobId
          ? head(`/dashboard/jobs/${jobId}?tab=pipeline`)
          : { status: "no job id" },
        jobDetailsTab: jobId
          ? head(`/dashboard/jobs/${jobId}?tab=details`)
          : { status: "no job id" },
      },
      jobWorkspaceHtml: jobId
        ? {
            tabs:
              get(`/dashboard/jobs/${jobId}`).includes("Candidates") &&
              get(`/dashboard/jobs/${jobId}?tab=pipeline`).includes("Pipeline") &&
              get(`/dashboard/jobs/${jobId}?tab=details`).includes("Job Details"),
            metrics: /Screening/.test(get(`/dashboard/jobs/${jobId}`)),
            advisory: /advisory/.test(get(`/dashboard/jobs/${jobId}`)),
          }
        : null,
      candidatesList: {
        aiMatch: /AI Match/.test(get("/dashboard/candidates")),
        stages: /Stage/.test(get("/dashboard/candidates")),
      },
      candidateDetail: (() => {
        const html = get("/dashboard/candidates");
        const m = html.match(/href="(\/dashboard\/candidates\/[^"]+)"/);
        if (!m) return null;
        const page = get(m[1]);
        return {
          path: m[1],
          profile: /Profile/.test(page),
          screening: /AI Screening/.test(page),
          interview: /Interview/.test(page),
          decision: /Recruiter Decision/.test(page),
          advisory: /recruiter decides/i.test(page),
        };
      })(),
      rbac: {
        candidateDashboard: {
          status: candDash.split("\n")[0]?.trim(),
          loc:
            candDash
              .split("\n")
              .find((l) => l.toLowerCase().startsWith("location:"))
              ?.trim() || "",
        },
        candidateApiCandidates: apiCand.trim(),
      },
    },
    null,
    2,
  ),
);
