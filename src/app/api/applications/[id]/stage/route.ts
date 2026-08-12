import { z } from "zod";
import type { PipelineStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline, requireUser, AuthError } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { PIPELINE_STAGES } from "@/lib/constants";

const bodySchema = z.object({
  toStage: z.enum(PIPELINE_STAGES as unknown as [PipelineStage, ...PipelineStage[]]),
  note: z.string().optional(),
});

type Ctx = { params: { id: string } };

/**
 * Manual stage transitions only. AI screening never calls this route.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = params;
    const session = await getSession();
    const user = requireUser(session);

    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const body = bodySchema.parse(await request.json());
    const application = await prisma.application.findUnique({
      where: { id },
      include: { job: { select: { organizationId: true } } },
    });
    if (!application) {
      return Response.json({ error: "Application not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }

    if (body.toStage === "SELECTED" || body.toStage === "REJECTED") {
      if (!body.note || body.note.trim().length < 5) {
        return Response.json(
          { error: "Final decisions require a human rationale (note)" },
          { status: 400 },
        );
      }
    }

    const status =
      body.toStage === "SELECTED"
        ? "HIRED"
        : body.toStage === "REJECTED"
          ? "REJECTED"
          : application.status === "HIRED" || application.status === "REJECTED"
            ? "ACTIVE"
            : application.status;

    const updated = await prisma.$transaction(async (tx) => {
      const app = await tx.application.update({
        where: { id },
        data: {
          stage: body.toStage,
          status,
        },
      });

      await tx.timelineEvent.create({
        data: {
          applicationId: id,
          type: "STAGE_CHANGED",
          payload: {
            from: application.stage,
            to: body.toStage,
            note: body.note ?? null,
            actorId: user.id,
            actorName: user.name,
            humanDecision: true,
          },
        },
      });

      return app;
    });

    return jsonOk({
      application: updated,
      advisoryNote:
        "AI recommendations are advisory only. This stage change was made by a human.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
