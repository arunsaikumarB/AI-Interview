/**
 * CLI wrapper around existing screenApplication / buildScreeningUserPrompt.
 * Usage:
 *   tsx scripts/screen-application.mjs <applicationId> <organizationId> <out.json>
 *   tsx scripts/screen-application.mjs <applicationId> <organizationId> <out.json> --fingerprint
 *
 * Output JSON never includes resume text, prompts, reasoning, or raw model content.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const applicationId = process.argv[2];
const organizationId = process.argv[3];
const outPath = process.argv[4];
const fingerprintOnly = process.argv.includes("--fingerprint");

function fail(errorClass, retryable = false) {
  return { ok: false, error_class: errorClass, retryable };
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function writeOut(payload) {
  if (!outPath) return;
  await writeFile(outPath, JSON.stringify(payload), "utf8");
}

async function main() {
  if (!applicationId || !organizationId || !outPath) {
    await writeOut(fail("invalid_args"));
    process.exit(2);
  }

  const prismaUrl = pathToFileURL(
    path.join(process.cwd(), "src", "lib", "db.ts"),
  ).href;
  const screeningUrl = pathToFileURL(
    path.join(process.cwd(), "src", "lib", "ai", "screening.ts"),
  ).href;
  const runUrl = pathToFileURL(
    path.join(process.cwd(), "src", "lib", "ai", "run-screening.ts"),
  ).href;

  const { prisma } = await import(prismaUrl);
  const { SYSTEM_PROMPT, buildScreeningUserPrompt, truncateResumeText } =
    await import(screeningUrl);

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { job: true, candidate: true },
  });

  if (!application) {
    await writeOut(fail("invalid_application"));
    process.exit(1);
  }
  if (application.job.organizationId !== organizationId) {
    await writeOut(fail("invalid_application"));
    process.exit(1);
  }
  if (application.candidate.organizationId !== organizationId) {
    await writeOut(fail("invalid_application"));
    process.exit(1);
  }

  const resumeText = application.candidate.resumeText?.trim() ?? "";
  if (!resumeText) {
    await writeOut(fail("missing_resume"));
    process.exit(1);
  }
  const description = (application.job.description ?? "").trim();
  if (!description) {
    await writeOut(fail("missing_job_description"));
    process.exit(1);
  }

  const { truncated } = truncateResumeText(resumeText);
  const userPrompt = buildScreeningUserPrompt({
    job: application.job,
    candidate: {
      firstName: application.candidate.firstName,
      lastName: application.candidate.lastName,
      summary: application.candidate.summary,
      skills: application.candidate.skills,
      experience: application.candidate.experience,
      education: application.candidate.education,
      certifications: application.candidate.certifications,
      resumeText,
    },
  });

  if (fingerprintOnly) {
    await writeOut({
      ok: true,
      fingerprint: true,
      application_id: applicationId,
      job_id: application.job.id,
      candidate_id: application.candidate.id,
      system_prompt_sha256: sha256(SYSTEM_PROMPT),
      user_prompt_sha256: sha256(userPrompt),
      prompt_sha256: sha256(`${SYSTEM_PROMPT}\n${userPrompt}`),
      resume_chars: resumeText.length,
      truncated,
      stage: application.stage,
      status: application.status,
    });
    return;
  }

  const stageBefore = application.stage;
  const statusBefore = application.status;
  const { screenApplication } = await import(runUrl);
  const { evaluation, embeddingUpdated } = await screenApplication(applicationId);

  const after = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { stage: true, status: true },
  });

  const overall =
    evaluation.scores && typeof evaluation.scores === "object"
      ? evaluation.scores.overall
      : null;

  await writeOut({
    ok: true,
    application_id: applicationId,
    evaluation_id: evaluation.id,
    kind: evaluation.kind,
    recommendation: evaluation.recommendation,
    overall,
    model: evaluation.model,
    embedding_updated: embeddingUpdated,
    stage_before: stageBefore,
    stage_after: after?.stage ?? null,
    status_before: statusBefore,
    status_after: after?.status ?? null,
    stage_unchanged: after?.stage === stageBefore,
    status_unchanged: after?.status === statusBefore,
    resume_chars: resumeText.length,
    user_prompt_sha256: sha256(userPrompt),
  });
}

main().catch(async (err) => {
  const code = err && typeof err === "object" ? err.code : undefined;
  const retryable =
    code === "OLLAMA_UNREACHABLE" ||
    (code === "OLLAMA_HTTP" && Number(err?.causeDetail?.status) >= 500);
  const errorClass =
    code === "OLLAMA_UNREACHABLE" || code === "OLLAMA_HTTP"
      ? "ollama_unavailable"
      : code === "INVALID_JSON" || code === "VALIDATION"
        ? "malformed_model_output"
        : "screening_failure";
  try {
    await writeOut({ ...fail(errorClass, retryable) });
  } catch {
    /* ignore */
  }
  process.exit(retryable ? 3 : 1);
});
