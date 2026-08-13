import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { ingestSecondaryChunk } from "@/lib/secondary-recording-server";
import { MAX_CHUNK_BYTES } from "@/lib/secondary-recording";

type Ctx = { params: { code: string } };

/**
 * Phone: upload one MediaRecorder chunk (idempotent by recordingId+chunkIndex).
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { secondaryPairToken: params.code },
      select: {
        id: true,
        status: true,
        tokenExpiresAt: true,
        secondaryPairExpiresAt: true,
        secondaryRecordingId: true,
        secondaryRecordingStatus: true,
        proctoringMode: true,
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
    if (session.proctoringMode !== "ENHANCED") {
      return Response.json({ error: "Not enhanced" }, { status: 400 });
    }
    if (
      session.status === "CANCELLED" ||
      session.secondaryRecordingStatus === "SAVED" ||
      session.secondaryRecordingStatus === "FAILED" ||
      session.secondaryRecordingStatus === "DISCARDED"
    ) {
      return Response.json({ error: "Recording closed" }, { status: 410 });
    }

    const form = await request.formData();
    const chunk = form.get("chunk");
    const recordingId = String(form.get("recordingId") ?? "");
    const chunkIndex = Number(form.get("chunkIndex"));
    const mime = String(form.get("mime") ?? "") || undefined;

    if (!(chunk instanceof File)) {
      return Response.json({ error: "chunk required" }, { status: 400 });
    }
    if (!recordingId || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return Response.json({ error: "Invalid chunk metadata" }, { status: 400 });
    }
    if (chunk.size > MAX_CHUNK_BYTES) {
      return Response.json({ error: "Chunk too large" }, { status: 413 });
    }
    if (
      session.secondaryRecordingId &&
      session.secondaryRecordingId !== recordingId
    ) {
      return Response.json({ error: "Recording mismatch" }, { status: 403 });
    }

    const buf = Buffer.from(await chunk.arrayBuffer());
    const result = await ingestSecondaryChunk({
      sessionId: session.id,
      recordingId,
      chunkIndex,
      data: buf,
      mime,
    });

    return jsonOk(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "RATE_LIMIT") {
      return Response.json(
        { error: "Upload rate limit", retryable: true },
        { status: 429 },
      );
    }
    if (
      msg === "RECORDING_MISMATCH" ||
      msg === "NOT_ACCEPTING_CHUNKS" ||
      msg === "ENDED"
    ) {
      return Response.json({ error: msg }, { status: 400 });
    }
    return handleApiError(err);
  }
}
