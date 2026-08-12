import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonOk } from "@/lib/api";

type Ctx = { params: { token: string } };

const bodySchema = z.object({
  acknowledged: z.literal(true),
  /** Explicit camera choice — stored as-is; never inferred later. */
  cameraConsent: z.boolean(),
});

/**
 * Record explicit proctoring consent before/during start.
 * Does not change Application.stage.
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await prisma.interviewSession.findUnique({
    where: { accessToken: params.token },
  });

  if (!session) {
    return Response.json({ error: "Interview not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json({ error: "This interview link has expired. Please contact the recruiter." }, { status: 410 });
  }
  if (!session.proctoringEnabled) {
    return Response.json(
      { error: "Proctoring is not enabled for this session" },
      { status: 403 },
    );
  }
  if (session.status === "COMPLETED" || session.status === "CANCELLED") {
    return Response.json({ error: "Interview is not available" }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 },
      );
    }
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const consentAt = new Date();
  await prisma.interviewSession.update({
    where: { id: session.id },
    data: {
      proctoringConsentAt: consentAt,
      proctoringCameraConsent: body.cameraConsent,
    },
  });

  await prisma.timelineEvent.create({
    data: {
      applicationId: session.applicationId,
      type: "OTHER",
      payload: {
        kind: "PROCTORING_CONSENT",
        sessionId: session.id,
        cameraConsent: body.cameraConsent,
        tabAndPasteSignals: true,
        consentedAt: consentAt.toISOString(),
        advisoryOnly: true,
      },
    },
  });

  return jsonOk({
    consentedAt: consentAt.toISOString(),
    cameraConsent: body.cameraConsent,
    consent: body.cameraConsent
      ? "full (incl. camera)"
      : "signals only (camera declined)",
  });
}
