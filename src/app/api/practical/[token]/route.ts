import { jsonError, jsonOk } from "@/lib/api";
import { limitCandidate, practicalErrorResponse } from "@/lib/practical/http";
import { getCandidateState } from "@/lib/practical/service";
import { ACCESS_TOKEN_RE } from "@/lib/practical/token";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

/** Candidate view of a practical assessment. Hidden tests and expected results are never included. */
export async function GET(request: Request, { params }: Ctx) {
  try {
    if (!ACCESS_TOKEN_RE.test(params.token)) return jsonError("Invalid link", 400);
    const limited = limitCandidate(request, params.token, "view", { limit: 60, windowMs: 60_000 }, { limit: 120, windowMs: 60_000 });
    if (limited) return limited;
    return jsonOk(await getCandidateState(params.token), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return practicalErrorResponse(err, "view");
  }
}
