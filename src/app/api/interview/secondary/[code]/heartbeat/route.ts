import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { jsonOk, withApiHandler } from "@/lib/api";
import {
  SECONDARY_AUDIT_KIND,
  parseBaselineReport,
  secondaryBaselineAuditPayload,
} from "@/lib/integrity";
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
      secondaryPlacementConfirmedAt: true,
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
  let rawBody: unknown = null;
  try {
    const body = await request.json();
    rawBody = body;
    disconnect = body?.disconnect === true;
  } catch {
    /* empty body ok */
  }

  // F-05 audit evidence — persisted before the disconnect branch below, which
  // clears `secondaryPlacementConfirmedAt`. The phone reports its baseline on
  // an ordinary heartbeat (no extra request, no new endpoint); the record is
  // append-only so it survives disconnect, reconnect, reset and completion.
  // Evidence only: nothing here affects detection or termination.
  const baseline = parseBaselineReport(rawBody);
  if (baseline) {
    const capturedAtIso = baseline.capturedAt.toISOString();
    // Heartbeats repeat, so the same capture must not be recorded twice.
    const already = await prisma.timelineEvent.findFirst({
      where: {
        applicationId: session.applicationId,
        type: "OTHER",
        AND: [
          { payload: { path: ["kind"], equals: SECONDARY_AUDIT_KIND.baselineCaptured } },
          { payload: { path: ["sessionId"], equals: session.id } },
          { payload: { path: ["capturedAt"], equals: capturedAtIso } },
        ],
      },
      select: { id: true },
    });
    if (!already) {
      await prisma.timelineEvent.create({
        data: {
          applicationId: session.applicationId,
          type: "OTHER",
          payload: secondaryBaselineAuditPayload({
            sessionId: session.id,
            capturedAt: baseline.capturedAt,
            settled: baseline.settled,
            // Pairs with the most recent preceding placement confirmation.
            placementConfirmedAt: session.secondaryPlacementConfirmedAt,
          }) as Prisma.InputJsonValue,
        },
      });
    }
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
