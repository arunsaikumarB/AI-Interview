import { getSession } from "@/lib/auth/session";
import {
  AuthError,
  canManagePipeline,
  orgScopeWhere,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getOrgAnalytics } from "@/lib/analytics";

/** Read-only org analytics — RECRUITER+ (not INTERVIEWER / CANDIDATE). */
export async function GET() {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const scope = orgScopeWhere(user);
    const analytics = await getOrgAnalytics(scope);
    return jsonOk(analytics);
  } catch (err) {
    return handleApiError(err);
  }
}
