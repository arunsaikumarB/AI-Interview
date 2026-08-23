import { handleApiError, jsonOk } from "@/lib/api";
import { finalizePrimaryRecording } from "@/lib/primary-camera-recording-server";

type Ctx = { params: { token: string } };

export async function POST(request: Request, { params }: Ctx) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      recordingId?: string;
      mime?: string;
    };
    if (!body.recordingId) {
      return Response.json({ error: "recordingId required" }, { status: 400 });
    }
    const result = await finalizePrimaryRecording({
      accessToken: params.token,
      recordingId: body.recordingId,
      mime: body.mime,
    });
    return jsonOk(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    if (msg === "NOT_FOUND" || msg === "NO_CAMERA_CONSENT") {
      return Response.json({ error: msg }, { status: 400 });
    }
    return handleApiError(err);
  }
}
