import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError } from "@/lib/api";
import { BodyError } from "@/lib/practical/http";
import { PracticalError } from "@/lib/practical/service";
import { AssessmentError } from "./service";

/** Pipeline staff only (INTERVIEWER → 403), same gate as the V3 practical routes. */
export async function requireAssessmentStaff() {
  const user = requireStaff(await getSession());
  if (!canManagePipeline(user.role)) throw new AuthError("Insufficient permissions", 403);
  return user;
}

export function assessmentErrorResponse(err: unknown, context: string): Response {
  if (err instanceof AssessmentError) return jsonError(err.message, err.status, { code: err.code });
  if (err instanceof PracticalError) return jsonError(err.message, err.status, { code: err.code });
  if (err instanceof BodyError) return jsonError(err.message, err.status);
  if (err instanceof AuthError || isDatabaseUnavailable(err)) return handleApiError(err);
  console.error(`[assessment] ${context} failed:`, err instanceof Error ? err.name : "unknown");
  return jsonError("Something went wrong. Please try again.", 500);
}
