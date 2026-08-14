import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { acknowledgeSecondaryWarning } from "@/lib/integrity-server";

type Ctx = { params: { token: string } };

/** Candidate acknowledged the secondary-camera warning and will continue. */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { accessToken: params.token },
      select: { id: true, status: true, tokenExpiresAt: true },
    });
    if (!session) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
      return Response.json({ error: "Interview expired" }, { status: 410 });
    }
    if (session.status !== "IN_PROGRESS") {
      return jsonOk({ ok: true, cleared: false });
    }
    return jsonOk(await acknowledgeSecondaryWarning(session.id));
  } catch (err) {
    return handleApiError(err);
  }
}
