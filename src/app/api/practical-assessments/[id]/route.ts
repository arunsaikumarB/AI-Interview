import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { jsonError, jsonOk } from "@/lib/api";
import { RECORD_ID_RE } from "@/lib/assessment/load";
import { practicalErrorResponse } from "@/lib/practical/http";
import { getPracticalDetail } from "@/lib/practical/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** Staff evidence view: objective execution results and the exact submitted source. No verdicts. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const user = requireStaff(await getSession());
    if (!canManagePipeline(user.role)) throw new AuthError("Insufficient permissions", 403);
    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid assessment id", 400);
    return jsonOk(await getPracticalDetail(user, params.id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return practicalErrorResponse(err, "detail");
  }
}
