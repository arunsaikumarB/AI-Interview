import { handleApiError, jsonOk } from "@/lib/api";
import { savePrimaryChunk } from "@/lib/primary-camera-recording-server";

type Ctx = { params: { token: string } };

export async function POST(request: Request, { params }: Ctx) {
  try {
    const form = await request.formData();
    const recordingId = String(form.get("recordingId") ?? "");
    const chunkIndex = Number(form.get("chunkIndex"));
    const file = form.get("chunk");
    if (!recordingId || !Number.isInteger(chunkIndex) || !(file instanceof Blob)) {
      return Response.json({ error: "Invalid chunk payload" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await savePrimaryChunk({
      accessToken: params.token,
      recordingId,
      chunkIndex,
      data: buf,
    });
    return jsonOk(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    if (
      msg === "NOT_FOUND" ||
      msg === "NO_CAMERA_CONSENT" ||
      msg === "BAD_STATUS" ||
      msg === "BAD_INDEX" ||
      msg === "EMPTY_CHUNK"
    ) {
      return Response.json({ error: msg }, { status: 400 });
    }
    return handleApiError(err);
  }
}
