import { jsonError, jsonOk } from "@/lib/api";
import { RECORD_ID_RE } from "@/lib/assessment/load";
import { assessmentErrorResponse, requireAssessmentStaff } from "@/lib/candidate-assessment/http";
import { getStaffAssessment } from "@/lib/candidate-assessment/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/**
 * Unified candidate assessment for one application: blueprint, component
 * status, objective evidence by competency. Read-only apart from the
 * idempotent "assessment_completed" audit row. Never a hiring recommendation.
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const user = await requireAssessmentStaff();
    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid application id", 400);
    return jsonOk({ assessment: await getStaffAssessment(user, params.id) });
  } catch (err) {
    return assessmentErrorResponse(err, "summary");
  }
}
