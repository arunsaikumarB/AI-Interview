/**
 * Adversarial Phase 9 isolation pass — Mallory outsider + portal account.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "testpass12345";
const EMAIL = `mallory.breach.${Date.now()}@example.com`;

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

const LEAK_RE =
  /overall|screeningScore|interviewScore|recommendation|reasoning|aiEvaluation|score\b|evaluations?/i;

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { res, data: await res.json(), cookie: cookieFrom(res) };
}

async function main() {
  const prisma = new PrismaClient();
  const results = [];
  const note = (name, ok, detail = "") => {
    results.push({ name, ok: Boolean(ok), detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };

  const careers = await (await fetch(`${BASE}/api/careers`)).json();
  // Prefer a job Mallory hasn't applied to; use first OPEN
  const job = careers.jobs.find((j) => j.title.includes("Full-Stack")) ?? careers.jobs[0];
  if (!job) throw new Error("No OPEN job");

  const resume = new Blob(
    [
      "Mallory Breach\nSecurity Tester\nSkills: TypeScript, adversarial testing, PostgreSQL\nExperience: 5 years building ATS isolation tests.\n",
    ],
    { type: "text/plain" },
  );

  const fd = new FormData();
  fd.set("jobId", job.id);
  fd.set("firstName", "Mallory");
  fd.set("lastName", "Breach");
  fd.set("email", EMAIL);
  fd.set("phone", "+1 555 0199");
  fd.set("location", "Remote");
  fd.set("coverNote", "Adversarial isolation test account");
  fd.set("password", PASSWORD);
  fd.set("website", "");
  fd.set("resume", resume, "mallory-resume.txt");

  const apply = await fetch(`${BASE}/api/careers/apply`, { method: "POST", body: fd });
  const applyJson = await apply.json();
  note(
    "Mallory apply with portal account",
    apply.status === 201 && applyJson.accountCreated === true,
    `status=${apply.status} app=${applyJson.applicationId ?? applyJson.error}`,
  );

  const mallory = await login(EMAIL, PASSWORD);
  note("Mallory login (CANDIDATE JWT)", mallory.res.ok && mallory.data.user?.role === "CANDIDATE");
  const cookie = mallory.cookie;

  // --- Staff endpoint breach attempts ---
  const staffHits = [
    ["POST", "/api/talent/search", { query: "engineer" }],
    ["GET", "/api/candidates", null],
    ["GET", "/api/interviews/any-id", null],
  ];
  for (const [method, path, body] of staffHits) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    note(`Mallory → 403 ${method} ${path}`, res.status === 403, `got ${res.status}`);
  }

  // Extra staff surfaces that historically leaked
  for (const path of [
    "/api/applications",
    "/api/applications/board",
    "/api/jobs",
    "/api/admin/users",
    "/api/talent/search",
  ]) {
    const method = path.includes("talent") ? "POST" : "GET";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify({ query: "x" }) : undefined,
    });
    note(`Mallory → 403 ${path}`, res.status === 403, `got ${res.status}`);
  }

  // --- Portal JSON leak grep ---
  const portalAppsRes = await fetch(`${BASE}/api/portal/applications`, {
    headers: { Cookie: cookie },
  });
  const portalApps = await portalAppsRes.json();
  const appsStr = JSON.stringify(portalApps);
  note("portal/applications OK", portalAppsRes.ok);
  note("portal/applications no score leakage", !LEAK_RE.test(appsStr), appsStr.slice(0, 200));

  const portalProfRes = await fetch(`${BASE}/api/portal/profile`, {
    headers: { Cookie: cookie },
  });
  const portalProf = await portalProfRes.json();
  const profStr = JSON.stringify(portalProf);
  note("portal/profile OK", portalProfRes.ok);
  note("portal/profile no score leakage", !LEAK_RE.test(profStr));

  // --- Cross-candidate IDOR (Alex) ---
  const alex = await prisma.candidate.findFirst({
    where: {
      OR: [
        { firstName: { equals: "Alex", mode: "insensitive" } },
        { email: { contains: "alex", mode: "insensitive" } },
      ],
    },
    include: {
      applications: { take: 1, select: { id: true } },
    },
  });
  if (!alex) {
    note("locate Alex for IDOR", false, "Alex not in DB");
  } else {
    note("locate Alex for IDOR", true, alex.id);

    // Staff candidate detail
    const cRes = await fetch(`${BASE}/api/candidates/${alex.id}`, {
      headers: { Cookie: cookie },
    });
    note(
      "IDOR: Mallory GET /api/candidates/{Alex}",
      cRes.status === 403,
      `got ${cRes.status}`,
    );

    const alexAppId = alex.applications[0]?.id;
    if (alexAppId) {
      const aRes = await fetch(`${BASE}/api/applications/${alexAppId}`, {
        headers: { Cookie: cookie },
      });
      const aBody = await aRes.json();
      const leaked =
        aRes.ok &&
        (aBody.application?.candidate?.id === alex.id ||
          aBody.application?.aiEvaluations);
      note(
        "IDOR: Mallory GET /api/applications/{AlexApp}",
        aRes.status === 403 && !leaked,
        `got ${aRes.status}`,
      );
    }

    // Portal must not accept foreign ids via query (if ignored, still only own rows)
    const qRes = await fetch(
      `${BASE}/api/portal/applications?candidateId=${alex.id}&applicationId=${alex.applications[0]?.id ?? ""}`,
      { headers: { Cookie: cookie } },
    );
    const qJson = await qRes.json();
    const foreign = (qJson.applications ?? []).some(
      (a) =>
        JSON.stringify(a).includes(alex.id) ||
        JSON.stringify(a).toLowerCase().includes("alex"),
    );
    const onlyMallory = (qJson.applications ?? []).every((a) =>
      // Mallory's own apps: stage labels only, job titles from her apply
      typeof a.jobTitle === "string",
    );
    note(
      "IDOR: portal ?candidateId=Alex still scoped to Mallory",
      qRes.ok && !foreign && onlyMallory,
      `rows=${(qJson.applications ?? []).length}`,
    );

    // Portal apps must not include Alex's job titles she didn't apply to
    // (weak check) — stronger: Mallory candidate id never equals Alex
    const malloryCand = await prisma.candidate.findFirst({
      where: { email: EMAIL },
    });
    note(
      "Mallory candidate ≠ Alex",
      malloryCand && malloryCand.id !== alex.id,
    );
  }

  // --- Staff pipeline sees Mallory APPLIED + parsed resume ---
  const admin = await login("admin@local.dev", "password123");
  const staffApps = await fetch(`${BASE}/api/applications`, {
    headers: { Cookie: admin.cookie },
  });
  const staffJson = await staffApps.json();
  const row = (staffJson.applications ?? []).find(
    (a) => a.id === applyJson.applicationId,
  );
  note(
    "staff pipeline: Mallory APPLICATION APPLIED",
    row && row.stage === "APPLIED" && row.candidate?.email === EMAIL,
    row ? `stage=${row.stage}` : "missing",
  );

  const malloryDb = await prisma.candidate.findFirst({ where: { email: EMAIL } });
  const emb = await prisma.$queryRawUnsafe(
    `SELECT ("embedding" IS NOT NULL) AS "hasEmb", length("resumeText") AS "len" FROM "Candidate" WHERE id = $1`,
    malloryDb.id,
  );
  note(
    "Mallory resume parsed + embedded",
    Boolean(malloryDb?.resumeUrl) &&
      (malloryDb?.resumeText?.length ?? 0) > 0 &&
      Boolean(emb[0]?.hasEmb),
    `textLen=${malloryDb?.resumeText?.length} emb=${emb[0]?.hasEmb}`,
  );

  await prisma.$disconnect();

  console.log("\n--- credentials (throwaway) ---");
  console.log(`email:    ${EMAIL}`);
  console.log(`password: ${PASSWORD}`);
  console.log(`job:      ${job.title} (${job.id})`);
  console.log(`appId:    ${applyJson.applicationId}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
