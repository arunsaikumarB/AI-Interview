import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import {
  clearLiveFrame,
  resolveSecondaryStatus,
  secondaryStatusLabel,
  touchHeartbeat,
} from "@/lib/secondary-camera";
import { signalSecondaryTransition } from "@/lib/secondary-camera-lifecycle";

type Ctx = { params: { code: string } };

/**
 * Lightweight keepalive — ephemeral lastSeen (no ProctoringEvent per beat).
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
    clearLiveFrame(session.id);
    return Response.json({ error: "Interview ended" }, { status: 410 });
  }
  if (
    !session.secondaryPairExpiresAt ||
    session.secondaryPairExpiresAt < new Date()
  ) {
    clearLiveFrame(session.id);
    return Response.json(
      { error: "This pairing code has expired. Ask for a new QR code." },
      { status: 410 },
    );
  }

  let disconnect = false;
  try {
    const body = await request.json();
    disconnect = body?.disconnect === true;
  } catch {
    /* empty body ok */
  }

  if (disconnect) {
    clearLiveFrame(session.id);
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: {
        secondaryDeviceStatus: "DISCONNECTED",
        secondaryDeviceLastSeenAt: null,
        secondaryPlacementConfirmedAt: null,
      },
    });
    await signalSecondaryTransition({
      sessionId: session.id,
      applicationId: session.applicationId,
      next: "DISCONNECTED",
    });
    return jsonOk({
      status: "DISCONNECTED",
      label: secondaryStatusLabel("DISCONNECTED"),
      message: "Secondary camera disconnected.",
    });
  }

  const hb = touchHeartbeat(session.id);
  if (!hb.ok) {
    return Response.json({ error: hb.error }, { status: 429 });
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
    next: status === "STALE" ? "STALE" : status,
  });

  return jsonOk({
    status,
    label: secondaryStatusLabel(status),
  });
});
