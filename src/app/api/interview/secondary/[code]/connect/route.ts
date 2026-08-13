import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import { touchHeartbeat } from "@/lib/secondary-camera";
import { signalSecondaryTransition } from "@/lib/secondary-camera-lifecycle";

type Ctx = { params: { code: string } };

/** Secondary device: claim/reconnect without creating a new InterviewSession. */
export const POST = withApiHandler<Ctx>(async (_request, { params }) => {
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

  const hb = touchHeartbeat(session.id);
  if (!hb.ok) {
    return Response.json({ error: hb.error }, { status: 429 });
  }

  // Placement must be re-confirmed after a full disconnect/reconnect cycle.
  const resetPlacement =
    session.secondaryDeviceStatus !== "CONNECTED" || hb.reconnect;

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: {
      secondaryDeviceStatus: "CONNECTED",
      secondaryDeviceLastSeenAt: new Date(),
      ...(resetPlacement ? { secondaryPlacementConfirmedAt: null } : {}),
    },
  });

  await signalSecondaryTransition({
    sessionId: session.id,
    applicationId: session.applicationId,
    next: "CONNECTED",
  });

  return jsonOk({
    status: "CONNECTED",
    message: "Secondary camera connected.",
    reconnect: hb.reconnect,
  });
});
