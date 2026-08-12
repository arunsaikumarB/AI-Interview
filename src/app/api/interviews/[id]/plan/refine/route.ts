import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { AIError, refineInterviewPlan } from "@/lib/ai/plan-refine";
import { parsePlan } from "@/lib/ai/interview-session";

type Ctx = { params: { id: string } };

const bodySchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
  /** Optional working draft; defaults to saved plan */
  plan: z.unknown().optional(),
});

/**
 * Preview an NL plan refine. Does NOT save — recruiter must confirm via PATCH.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
      include: {
        application: {
          include: { job: { select: { organizationId: true } } },
        },
      },
    });
    if (!interview) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      interview.application.job.organizationId !== user.organizationId
    ) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (interview.status !== "SCHEDULED") {
      return Response.json(
        { error: "Plan is locked once the interview is in progress" },
        { status: 400 },
      );
    }

    const body = bodySchema.parse(await request.json());
    const current = body.plan
      ? parsePlan(body.plan)
      : parsePlan(interview.plan);

    try {
      const result = await refineInterviewPlan({
        current,
        instruction: body.instruction,
      });
      return jsonOk({
        plan: result.plan,
        changeSummary: result.changeSummary,
        model: result.model,
        saved: false,
      });
    } catch (err) {
      if (err instanceof AIError) {
        return Response.json(
          {
            error: err.message,
            code: err.code,
            planUnchanged: true,
          },
          { status: err.code === "VALIDATION" ? 400 : 503 },
        );
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
