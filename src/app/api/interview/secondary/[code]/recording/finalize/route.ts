import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { finalizeSecondaryRecording } from "@/lib/secondary-recording-server";

type Ctx = { params: { code: string } };

/** Phone or host-triggered finalize after interview ends. Idempotent. */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { secondaryPairToken: params.code },
      select: { id: true },
    });
    if (!session) {
      // Pair token may already be cleared — try nothing
      return Response.json({ error: "Pairing code not found" }, { status: 404 });
    }
    const result = await finalizeSecondaryRecording(session.id);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
