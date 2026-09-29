import { jsonError, jsonOk } from "@/lib/api";
import { limitCandidate, practicalErrorResponse } from "@/lib/practical/http";
import { startPracticalAssessment } from "@/lib/practical/service";
import { ACCESS_TOKEN_RE } from "@/lib/practical/token";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

export async function POST(request: Request, { params }: Ctx) {
  try {
    if (!ACCESS_TOKEN_RE.test(params.token)) return jsonError("Invalid link", 400);
    const limited = limitCandidate(request, params.token, "start", { limit: 10, windowMs: 60_000 }, { limit: 30, windowMs: 60_000 });
    if (limited) return limited;
    return jsonOk(await startPracticalAssessment(params.token), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return practicalErrorResponse(err, "start");
  }
}
