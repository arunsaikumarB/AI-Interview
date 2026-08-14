import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { acknowledgeSecondaryWarning } from "@/lib/integrity-server";

type Ctx = { params: { code: string } };

/** Phone: candidate acknowledged the secondary-camera warning. */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { secondaryPairToken: params.code },
      select: { id: true, status: true },
    });
    if (!session) {
      return Response.json({ error: "Pairing code not found" }, { status: 404 });
    }
    if (session.status !== "IN_PROGRESS") {
      return jsonOk({ ok: true, cleared: false });
    }
    return jsonOk(await acknowledgeSecondaryWarning(session.id));
  } catch (err) {
    return handleApiError(err);
  }
}
