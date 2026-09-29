import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireUser } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { AssessmentEngineService } from "@/lib/assessment/service";
import { loadBlueprintSources, RECORD_ID_RE } from "@/lib/assessment/load";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const QuerySchema = z
  .object({
    applicationId: z.string().regex(RECORD_ID_RE).optional(),
    view: z
      .enum(["full", "analysis", "classification", "competencies", "plan", "resume-questions"])
      .default("full"),
  })
  .strict();

/**
 * Assessment Engine V1 — advisory blueprint for recruiters.
 * Read-only: computes on demand, writes nothing, calls no AI model and never
 * changes an application stage or status.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireUser(session);
    if (!canManagePipeline(user.role)) throw new AuthError("Insufficient permissions", 403);

    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid job id", 400);

    const url = new URL(request.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return jsonError("Invalid query parameters", 400);
    const { applicationId, view } = parsed.data;
    if (view === "resume-questions" && !applicationId) {
      return jsonError("applicationId is required for resume-questions", 400);
    }

    const sources = await loadBlueprintSources(user, params.id, applicationId ?? null);
    if (sources.kind === "JOB_NOT_FOUND") return jsonError("Job not found", 404);
    if (sources.kind === "APPLICATION_NOT_FOUND") return jsonError("Application not found", 404);

    const blueprint = AssessmentEngineService.buildBlueprint({
      job: sources.job,
      candidate: sources.candidate,
    });

    const meta = {
      engineVersion: blueprint.engineVersion,
      generatedAt: blueprint.generatedAt,
      job: blueprint.job,
      candidate: blueprint.candidate,
      guardrails: blueprint.guardrails,
    };

    switch (view) {
      case "analysis":
        return jsonOk({ ...meta, analysis: blueprint.analysis });
      case "classification":
        return jsonOk({ ...meta, classification: blueprint.classification });
      case "competencies":
        return jsonOk({ ...meta, competencies: blueprint.competencies });
      case "plan":
        return jsonOk({ ...meta, plan: blueprint.plan, practical: blueprint.practical });
      case "resume-questions":
        return jsonOk({
          ...meta,
          resume: blueprint.resume,
          questions: blueprint.questions.filter((q) => q.source === "RESUME" || q.purpose === "PROBE_GAP"),
        });
      default:
        return jsonOk(blueprint);
    }
  } catch (err) {
    if (err instanceof AuthError || isDatabaseUnavailable(err)) return handleApiError(err);
    console.error("[assessment-blueprint] generation failed:", err instanceof Error ? err.name : "unknown");
    return jsonError("Assessment blueprint could not be generated", 500);
  }
}
