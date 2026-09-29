import { jsonError, jsonOk } from "@/lib/api";
import { limitCandidate, practicalErrorResponse, readJsonBody } from "@/lib/practical/http";
import { saveDraft } from "@/lib/practical/service";
import { ACCESS_TOKEN_RE } from "@/lib/practical/token";
import { DRAFT_MAX_BYTES } from "@/lib/practical/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

/** Autosave. Stores the draft only — never executes and never submits. */
export async function PUT(request: Request, { params }: Ctx) {
  try {
    if (!ACCESS_TOKEN_RE.test(params.token)) return jsonError("Invalid link", 400);
    const limited = limitCandidate(request, params.token, "draft", { limit: 30, windowMs: 60_000 }, { limit: 90, windowMs: 60_000 });
    if (limited) return limited;
    const body = await readJsonBody(request, DRAFT_MAX_BYTES * 2 + 1024);
    return jsonOk(await saveDraft(params.token, body));
  } catch (err) {
    return practicalErrorResponse(err, "draft");
  }
}
