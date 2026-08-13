import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { markSecondaryRecordingInterrupted } from "@/lib/secondary-recording-server";

type Ctx = { params: { code: string } };

const bodySchema = z.object({
  gapMs: z.number().int().min(0).max(60 * 60 * 1000).default(0),
});

/** Phone: mark recording interrupted (network/background) — not a cheating claim. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { secondaryPairToken: params.code },
      select: { id: true },
    });
    if (!session) {
      return Response.json({ error: "Pairing code not found" }, { status: 404 });
    }
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    await markSecondaryRecordingInterrupted(session.id, body.gapMs);
    return jsonOk({ ok: true, status: "INTERRUPTED" });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "Validation failed" }, { status: 400 });
    }
    return handleApiError(err);
  }
}
