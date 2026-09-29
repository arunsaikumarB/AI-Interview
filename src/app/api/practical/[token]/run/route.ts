import { jsonError, jsonOk } from "@/lib/api";
import { limitCandidate, practicalErrorResponse, readJsonBody } from "@/lib/practical/http";
import { runPractical } from "@/lib/practical/service";
import { ACCESS_TOKEN_RE } from "@/lib/practical/token";
import { CODING_HARD_LIMITS } from "@/lib/practical/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

/** Run Code / Run Query: visible tests or the query's result table only. Nothing is stored. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    if (!ACCESS_TOKEN_RE.test(params.token)) return jsonError("Invalid link", 400);
    const limited = limitCandidate(request, params.token, "run", { limit: 10, windowMs: 60_000 }, { limit: 30, windowMs: 60_000 });
    if (limited) return limited;
    const body = await readJsonBody(request, CODING_HARD_LIMITS.sourceMaxBytes * 2 + 1024);
    return jsonOk(await runPractical(params.token, body), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return practicalErrorResponse(err, "run");
  }
}
