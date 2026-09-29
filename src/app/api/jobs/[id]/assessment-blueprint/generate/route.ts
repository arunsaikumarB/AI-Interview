import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireUser } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { AssessmentEngineService } from "@/lib/assessment/service";
import {
  generateAiAssistedBlueprint,
  timelineAuditSink,
  type TimelineWriter,
} from "@/lib/assessment/ai-service";
import { loadBlueprintSources, RECORD_ID_RE } from "@/lib/assessment/load";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** organizationId, resume text, stage etc. are never accepted from the browser. */
const BodySchema = z
  .object({
    applicationId: z.string().regex(RECORD_ID_RE).optional(),
  })
  .strict();

const MAX_BODY_BYTES = 1_024;
const inflight = new Set<string>();

/**
 * Assessment Engine V2 — AI-assisted question wording on top of the V1
 * blueprint. Returns the blueprint without persisting it. Never changes a
 * stage, status or decision, never creates an interview or AIEvaluation; the
 * only write is a TimelineEvent audit when questions fall back.
 */
export async function POST(request: Request, { params }: Ctx) {
  let lockKey: string | null = null;
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManagePipeline(user.role)) throw new AuthError("Insufficient permissions", 403);

    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid job id", 400);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return jsonError("Content-Type must be application/json", 415);
    }
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) return jsonError("Invalid request body", 400);
    let body: unknown = {};
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return jsonError("Invalid request body", 400);
      }
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid request body", 400);
    const applicationId = parsed.data.applicationId ?? null;

    const sources = await loadBlueprintSources(user, params.id, applicationId);
    if (sources.kind === "JOB_NOT_FOUND") return jsonError("Job not found", 404);
    if (sources.kind === "APPLICATION_NOT_FOUND") return jsonError("Application not found", 404);

    if (inflight.has(user.id)) {
      return jsonError("A question generation is already running for your account", 409);
    }
    const limited = rateLimit({ key: `assessment-ai:${user.id}`, limit: 6, windowMs: 10 * 60_000 });
    if (!limited.ok) return jsonError("Too many generation requests. Try again in a few minutes.", 429);
    lockKey = user.id;
    inflight.add(lockKey);

    const blueprint = AssessmentEngineService.buildBlueprint({
      job: sources.job,
      candidate: sources.candidate,
    });

    const result = await generateAiAssistedBlueprint({
      blueprint,
      candidate: sources.candidate,
      actorId: user.id,
      audit: timelineAuditSink(prisma as unknown as TimelineWriter),
    });

    if (result.generationSummary.fallback > 0) {
      console.warn("[assessment-ai] deterministic fallback", {
        jobId: result.job.id,
        fallback: result.generationSummary.fallback,
        total: result.generationSummary.total,
        audit: result.generationSummary.audit,
        failureTypes: Array.from(
          new Set(result.questions.map((q) => q.generation.failureType).filter(Boolean)),
        ),
      });
    }

    return jsonOk(result);
  } catch (err) {
    if (err instanceof AuthError || isDatabaseUnavailable(err)) return handleApiError(err);
    console.error("[assessment-ai] generation failed:", err instanceof Error ? err.name : "unknown");
    return jsonError("AI-assisted blueprint could not be generated", 500);
  } finally {
    if (lockKey) inflight.delete(lockKey);
  }
}
