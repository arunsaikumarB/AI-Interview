import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { recordSecondaryIntegrityViolation } from "@/lib/integrity-server";

type Ctx = { params: { code: string } };

const bodySchema = z.object({
  kind: z.enum([
    "CAMERA_MOVED",
    "PERSON_MISSING",
    "EXTRA_PERSON",
    "LOOKING_AT_SECONDARY",
  ]),
  timestamp: z.string().datetime(),
  episodeId: z.string().min(1).max(80).optional(),
  faceCount: z.number().int().min(0).max(20).optional(),
});

/**
 * Secondary-device environment integrity (Enhanced).
 * Server may TERMINATE the InterviewSession. Never changes Application.stage.
 * Never feeds AI.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { secondaryPairToken: params.code },
      select: {
        id: true,
        status: true,
        tokenExpiresAt: true,
        proctoringMode: true,
        proctoringEnabled: true,
        secondaryPlacementConfirmedAt: true,
        secondaryRecordingConsentAt: true,
      },
    });

    if (!session) {
      return Response.json({ error: "Pairing code not found" }, { status: 404 });
    }
    if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
      return Response.json({ error: "Interview expired" }, { status: 410 });
    }
    if (session.status === "TERMINATED") {
      return jsonOk({
        ok: true,
        recorded: false,
        terminated: true,
        status: "TERMINATED",
        showWarning: false,
      });
    }
    if (session.status !== "IN_PROGRESS") {
      return Response.json(
        { error: "Interview is not in progress" },
        { status: 400 },
      );
    }
    if (session.proctoringMode !== "ENHANCED" || !session.proctoringEnabled) {
      return jsonOk({
        ok: true,
        recorded: false,
        terminated: false,
        status: session.status,
        showWarning: false,
      });
    }
    if (
      !session.secondaryPlacementConfirmedAt ||
      !session.secondaryRecordingConsentAt
    ) {
      return Response.json(
        { error: "Secondary camera placement and recording consent required" },
        { status: 403 },
      );
    }

    const body = bodySchema.parse(await request.json());
    const result = await recordSecondaryIntegrityViolation({
      sessionId: session.id,
      kind: body.kind,
      timestamp: new Date(body.timestamp),
      episodeId: body.episodeId,
      meta: {
        kind: body.kind,
        ...(body.faceCount != null ? { faceCount: body.faceCount } : {}),
      },
    });

    return jsonOk({
      ...result,
      kind: body.kind,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof Error && err.message === "SESSION_NOT_FOUND") {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    return handleApiError(err);
  }
}
