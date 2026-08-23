import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { startPrimaryRecording } from "@/lib/primary-camera-recording-server";

type Ctx = { params: { token: string } };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { accessToken: params.token },
      select: { id: true },
    });
    if (!session) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    const started = await startPrimaryRecording({ accessToken: params.token });
    return jsonOk(started);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    if (msg === "NOT_FOUND") {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (msg === "NOT_IN_PROGRESS" || msg === "NO_CAMERA_CONSENT") {
      return Response.json({ error: msg }, { status: 400 });
    }
    return handleApiError(err);
  }
}
