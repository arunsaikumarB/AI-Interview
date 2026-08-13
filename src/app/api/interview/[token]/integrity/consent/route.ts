import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleApiError, jsonOk } from "@/lib/api";
import { parseIntegrityMode } from "@/lib/integrity";

type Ctx = { params: { token: string } };

const bodySchema = z.object({
  acknowledged: z.literal(true),
});

/**
 * Candidate acknowledges Strict integrity requirements before start.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { accessToken: params.token },
      select: {
        id: true,
        status: true,
        tokenExpiresAt: true,
        integrityMode: true,
        integrityConsentAt: true,
      },
    });

    if (!session) {
      return Response.json({ error: "Interview not found" }, { status: 404 });
    }
    if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
      return Response.json(
        { error: "This interview link has expired." },
        { status: 410 },
      );
    }
    if (
      session.status === "COMPLETED" ||
      session.status === "CANCELLED" ||
      session.status === "TERMINATED"
    ) {
      return Response.json(
        { error: "Interview is no longer available" },
        { status: 410 },
      );
    }

    bodySchema.parse(await request.json());

    if (parseIntegrityMode(session.integrityMode) !== "STRICT") {
      return jsonOk({
        ok: true,
        integrityMode: "STANDARD",
        consentedAt: session.integrityConsentAt,
      });
    }

    if (session.integrityConsentAt) {
      return jsonOk({
        ok: true,
        integrityMode: "STRICT",
        consentedAt: session.integrityConsentAt.toISOString(),
      });
    }

    const updated = await prisma.interviewSession.update({
      where: { id: session.id },
      data: { integrityConsentAt: new Date() },
      select: { integrityConsentAt: true },
    });

    return jsonOk({
      ok: true,
      integrityMode: "STRICT",
      consentedAt: updated.integrityConsentAt!.toISOString(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 },
      );
    }
    return handleApiError(err);
  }
}
