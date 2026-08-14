import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import { putLiveFrame, putFraming, resolveSecondaryStatus } from "@/lib/secondary-camera";
import { signalSecondaryTransition } from "@/lib/secondary-camera-lifecycle";

type Ctx = { params: { code: string } };

/**
 * Secondary device uploads an ephemeral JPEG preview frame (memory only).
 * No disk. No DB blob. No LLM. Rate-limited.
 */
export const POST = withApiHandler<Ctx>(async (request, { params }) => {
  const session = await prisma.interviewSession.findUnique({
    where: { secondaryPairToken: params.code },
    select: {
      id: true,
      applicationId: true,
      status: true,
      tokenExpiresAt: true,
      secondaryPairExpiresAt: true,
      proctoringMode: true,
      secondaryDeviceStatus: true,
    },
  });
  if (!session) {
    return Response.json({ error: "Pairing code not found" }, { status: 404 });
  }
  if (session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
    return Response.json(
      {
        error:
          "This interview link has expired. Please contact the recruiter.",
      },
      { status: 410 },
    );
  }
  if (session.status === "COMPLETED" || session.status === "CANCELLED" || session.status === "TERMINATED") {
    return Response.json({ error: "Interview ended" }, { status: 410 });
  }
  if (
    !session.secondaryPairExpiresAt ||
    session.secondaryPairExpiresAt < new Date()
  ) {
    return Response.json(
      { error: "This pairing code has expired. Ask for a new QR code." },
      { status: 410 },
    );
  }
  if (session.proctoringMode !== "ENHANCED") {
    return Response.json(
      { error: "Secondary camera connection unavailable." },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const file = form.get("frame");
  if (!(file instanceof Blob) || file.size === 0) {
    return Response.json({ error: "Frame required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = putLiveFrame({
    sessionId: session.id,
    mime: file.type || "image/jpeg",
    data: buffer,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 429 });
  }

  const framingRaw = form.get("framing");
  if (typeof framingRaw === "string" && framingRaw.length > 0 && framingRaw.length < 500) {
    try {
      const parsed = JSON.parse(framingRaw) as {
        candidateVisible?: unknown;
        extraPersonInPrimaryZone?: unknown;
        laptopVisible?: unknown;
        personCount?: unknown;
      };
      putFraming(session.id, {
        candidateVisible: parsed.candidateVisible === true,
        extraPersonInPrimaryZone: parsed.extraPersonInPrimaryZone === true,
        laptopVisible: parsed.laptopVisible === true,
        personCount:
          typeof parsed.personCount === "number" &&
          parsed.personCount >= 0 &&
          parsed.personCount <= 20
            ? Math.floor(parsed.personCount)
            : 0,
      });
    } catch {
      /* ignore malformed framing */
    }
  }

  const status = resolveSecondaryStatus({
    stored: "CONNECTED",
    interviewStatus: session.status,
    pairExpiresAt: session.secondaryPairExpiresAt,
    sessionId: session.id,
  });
  await signalSecondaryTransition({
    sessionId: session.id,
    applicationId: session.applicationId,
    next: status,
  });

  return jsonOk({ ok: true });
});
