import { jsonError, jsonOk } from "@/lib/api";
import { ACCESS_TOKEN_RE } from "@/lib/practical/token";
import { limitCandidate } from "@/lib/practical/http";
import { assessmentErrorResponse } from "@/lib/candidate-assessment/http";
import { getCandidateHub } from "@/lib/candidate-assessment/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

/**
 * Candidate assessment hub (magic link). Component labels, statuses and launch
 * links only — no ids, no rubrics, no hidden tests, no results, no AI metadata.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    if (!ACCESS_TOKEN_RE.test(params.token)) return jsonError("Invalid link", 400);
    const limited = limitCandidate(
      request,
      params.token,
      "hub",
      { limit: 60, windowMs: 60_000 },
      { limit: 120, windowMs: 60_000 },
    );
    if (limited) return limited;
    return jsonOk({ hub: await getCandidateHub(params.token) });
  } catch (err) {
    return assessmentErrorResponse(err, "hub");
  }
}
