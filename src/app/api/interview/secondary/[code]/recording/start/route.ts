import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { startSecondaryRecording } from "@/lib/secondary-recording-server";

type Ctx = { params: { code: string } };

/**
 * Phone: begin secondary recording after interview start + placement + consent.
 */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { secondaryPairToken: params.code },
      select: {
        id: true,
        status: true,
        tokenExpiresAt: true,
        secondaryPairExpiresAt: true,
        proctoringMode: true,
        proctoringEnabled: true,
      },
    });
    if (!session) {
      return Response.json({ error: "Pairing code not found" }, { status: 404 });
    }
    if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
      return Response.json({ error: "Interview expired" }, { status: 410 });
    }
    if (
      !session.secondaryPairExpiresAt ||
      session.secondaryPairExpiresAt < new Date()
    ) {
      return Response.json({ error: "Pairing expired" }, { status: 410 });
    }
    if (session.proctoringMode !== "ENHANCED" || !session.proctoringEnabled) {
      return Response.json({ error: "Not enhanced" }, { status: 400 });
    }

    const result = await startSecondaryRecording(session.id);
    return jsonOk(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "NOT_IN_PROGRESS") {
      return Response.json(
        { error: "Interview has not started yet" },
        { status: 400 },
      );
    }
    if (msg === "NO_PLACEMENT" || msg === "NO_RECORDING_CONSENT") {
      return Response.json({ error: msg }, { status: 403 });
    }
    if (msg === "ALREADY_SAVED") {
      return Response.json({ error: "Recording already saved" }, { status: 400 });
    }
    return handleApiError(err);
  }
}
