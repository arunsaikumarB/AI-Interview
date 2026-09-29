import { z } from "zod";
import { jsonCreated, jsonError, jsonOk } from "@/lib/api";
import { RECORD_ID_RE } from "@/lib/assessment/load";
import { rateLimit } from "@/lib/rate-limit";
import { readJsonBody } from "@/lib/practical/http";
import { assessmentErrorResponse, requireAssessmentStaff } from "@/lib/candidate-assessment/http";
import { issueHubLink, revokeHubLink } from "@/lib/candidate-assessment/service";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** The application comes from the URL and is org-checked; the body may not carry anything. */
const EmptyBodySchema = z.object({}).strict();

/** Issue (or rotate) the candidate hub link. The raw link is returned once and never stored. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const user = await requireAssessmentStaff();
    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid application id", 400);
    if (!rateLimit({ key: `assessment:link:${user.id}`, limit: 20, windowMs: 60_000 }).ok) {
      return jsonError("Too many requests. Please wait a moment and try again.", 429);
    }
    if (!EmptyBodySchema.safeParse(await readJsonBody(request, 256)).success) return jsonError("Invalid request", 400);
    return jsonCreated(await issueHubLink(user, params.id));
  } catch (err) {
    return assessmentErrorResponse(err, "issue-link");
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const user = await requireAssessmentStaff();
    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid application id", 400);
    return jsonOk(await revokeHubLink(user, params.id));
  } catch (err) {
    return assessmentErrorResponse(err, "revoke-link");
  }
}
