import { z, ZodError } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, requireOrganizationId, requireRoles } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { UPLOAD_ROLES } from "@/lib/resume-upload/constants";
import {
  addCandidateToJob,
  addResumeParserProfile,
  getResumeParserClient,
  recallProfile,
  ResumeParserNotConfiguredError,
  ResumeParserUnavailableError,
} from "@/lib/integrations/resume-parser";
import { resumeParserErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    profileId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    jobId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Adds one Resume Parser profile to the Talent Pool, and optionally to one OPEN job with
 * advisory AI screening queued. Only the profile id and job id come from the browser; the
 * profile details come from this server's own recent search results.
 */
export async function POST(request: Request) {
  try {
    const user = requireRoles(await getSession(), UPLOAD_ROLES);
    const organizationId = requireOrganizationId(user);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStore(jsonError("Choose a profile to add.", 400));
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return noStore(jsonError("Choose a profile to add.", 400));
    const { profileId, jobId } = parsed.data;

    const client = getResumeParserClient();
    if (!client.configured) throw new ResumeParserNotConfiguredError();

    const rl = rateLimit({ key: `resume-parser-add:${user.id}`, limit: 100, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return noStore(jsonError("Too many profiles added. Wait a few minutes and try again.", 429));

    const profile = recallProfile(organizationId, profileId);
    if (!profile) return noStore(jsonError("Search again, then add this profile.", 404));

    let job: { id: string; title: string } | null = null;
    if (jobId) {
      job = await prisma.job.findFirst({
        where: { id: jobId, organizationId, status: "OPEN" },
        select: { id: true, title: true },
      });
      if (!job) return noStore(jsonError("Choose an open job opening.", 400));
    }

    const { extractResumeText } = await import("@/lib/resume/parse");
    const { embedCandidate } = await import("@/lib/ai/embeddings");
    const { queueProfileReading } = await import("@/lib/resume-upload/profile-worker");
    const result = await addResumeParserProfile(prisma, {
      organizationId,
      userId: user.id,
      profile,
      client,
      deps: { extractText: extractResumeText, embed: embedCandidate, queueProfile: queueProfileReading },
    });

    switch (result.status) {
      case "no_email":
        return noStore(jsonError("This profile has no email address, so it cannot be added.", 422));
      case "no_file":
        return noStore(jsonError("Resume Parser has no resume file for this profile.", 404));
      case "invalid_file":
        return noStore(jsonError(`The resume file cannot be used: ${result.reason}`, 422));
    }

    if (!job) return noStore(jsonOk(result, { status: result.status === "created" ? 201 : 200 }));

    const { queueAutoScreening } = await import("@/lib/ai/auto-screening");
    const placed = await addCandidateToJob(
      prisma,
      { organizationId, candidateId: result.candidateId, jobId: job.id },
      queueAutoScreening,
    );
    const payload = { ...result, jobTitle: job.title, ...placed };
    if (placed.job === "added") return noStore(jsonOk(payload, { status: 201 }));
    if (placed.job === "already_in_job") return noStore(jsonOk(payload));
    if (placed.job === "job_not_open") {
      return noStore(jsonError("This job opening is no longer open.", 400, { candidateId: result.candidateId }));
    }
    return noStore(jsonError("The profile could not be added. Try again.", 500));
  } catch (err) {
    if (err instanceof ResumeParserNotConfiguredError || err instanceof ResumeParserUnavailableError) {
      return noStore(resumeParserErrorResponse(err));
    }
    if (err instanceof AuthError || err instanceof ZodError || isDatabaseUnavailable(err)) {
      return noStore(handleApiError(err));
    }
    console.error("[resume-parser/add] failed", { name: err instanceof Error ? err.name : typeof err });
    return noStore(jsonError("The profile could not be added. Try again.", 500));
  }
}
