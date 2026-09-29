import { jsonError } from "@/lib/api";
import { limitCandidate, practicalErrorResponse, readJsonBody } from "@/lib/practical/http";
import { submitPractical } from "@/lib/practical/service";
import { ACCESS_TOKEN_RE } from "@/lib/practical/token";
import { CODING_HARD_LIMITS } from "@/lib/practical/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

/** Final submission: frozen once, executed server-side in the sandbox. The candidate never receives a score. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    if (!ACCESS_TOKEN_RE.test(params.token)) return jsonError("Invalid link", 400);
    const limited = limitCandidate(request, params.token, "submit", { limit: 5, windowMs: 60_000 }, { limit: 20, windowMs: 60_000 });
    if (limited) return limited;
    const body = await readJsonBody(request, CODING_HARD_LIMITS.sourceMaxBytes * 2 + 1024);
    const outcome = await submitPractical(params.token, body);
    return Response.json(
      { status: outcome.status, submittedAt: outcome.submittedAt, sourceSha256: outcome.sourceSha256 },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return practicalErrorResponse(err, "submit");
  }
}
