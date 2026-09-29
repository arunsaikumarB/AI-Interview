import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { jsonCreated, jsonError, jsonOk } from "@/lib/api";
import { RECORD_ID_RE } from "@/lib/assessment/load";
import { rateLimit } from "@/lib/rate-limit";
import { practicalErrorResponse, readJsonBody } from "@/lib/practical/http";
import { assignPracticalAssessment, listPracticalAssessments } from "@/lib/practical/service";
import { AssignInputSchema } from "@/lib/practical/types";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

async function staff() {
  const user = requireStaff(await getSession());
  if (!canManagePipeline(user.role)) throw new AuthError("Insufficient permissions", 403);
  return user;
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const user = await staff();
    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid application id", 400);
    return jsonOk({ assessments: await listPracticalAssessments(user, params.id) });
  } catch (err) {
    return practicalErrorResponse(err, "list");
  }
}

/**
 * Assign a CODING or SQL practical. The task, competency, difficulty, tests and
 * limits come from the blueprint and the server task library — the browser only
 * chooses the runtime. The candidate link is returned once and never stored.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const user = await staff();
    if (!RECORD_ID_RE.test(params.id)) return jsonError("Invalid application id", 400);
    if (!rateLimit({ key: `practical:assign:${user.id}`, limit: 20, windowMs: 60_000 }).ok) {
      return jsonError("Too many requests. Please wait a moment and try again.", 429);
    }
    const parsed = AssignInputSchema.safeParse(await readJsonBody(request, 1024));
    if (!parsed.success) return jsonError("Invalid request", 400);
    const { assessment, candidatePath } = await assignPracticalAssessment(user, params.id, parsed.data.type);
    return jsonCreated({ assessment, candidatePath });
  } catch (err) {
    return practicalErrorResponse(err, "assign");
  }
}
