import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { jsonError, jsonOk } from "@/lib/api";
import { RECORD_ID_RE } from "@/lib/assessment/load";
import { practicalErrorResponse } from "@/lib/practical/http";
import { cancelPracticalAssessment } from "@/lib/practical/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** Cancels an unsubmitted assessment. Does not touch the application stage. */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const user = requireStaff(await getSession());
    if (!canManagePipeline(user.role)) throw new AuthError("Insufficient permissions", 403);
    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid assessment id", 400);
    return jsonOk(await cancelPracticalAssessment(user, params.id));
  } catch (err) {
    return practicalErrorResponse(err, "cancel");
  }
}
