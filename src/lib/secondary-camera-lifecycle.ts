import { prisma } from "@/lib/db";
import {
  clearSecondaryRuntime,
  getLastSignaled,
  markSignaled,
  type SecondaryRuntimeStatus,
} from "@/lib/secondary-camera";

/**
 * Persist transition-only secondary camera signals (never every heartbeat/frame).
 * Does not touch AI scores or application stage.
 */
export async function signalSecondaryTransition(params: {
  sessionId: string;
  applicationId: string;
  next: SecondaryRuntimeStatus;
}): Promise<void> {
  const prev = getLastSignaled(params.sessionId);
  let coarse: "CONNECTED" | "DISCONNECTED" | "ENDED" | null = null;

  if (params.next === "CONNECTED" && prev !== "CONNECTED") {
    coarse = "CONNECTED";
  } else if (
    (params.next === "DISCONNECTED" || params.next === "ENDED") &&
    prev === "CONNECTED"
  ) {
    coarse = params.next === "ENDED" ? "ENDED" : "DISCONNECTED";
  } else if (params.next === "ENDED" && prev !== "ENDED") {
    coarse = "ENDED";
  }

  if (!coarse) return;

  if (coarse === "CONNECTED") {
    await prisma.proctoringEvent.create({
      data: {
        sessionId: params.sessionId,
        type: "SECONDARY_CAMERA_CONNECTED",
        timestamp: new Date(),
        meta: { advisoryOnly: true, source: "secondary_camera" },
      },
    });
    markSignaled(params.sessionId, "CONNECTED");
    await prisma.interviewSession.update({
      where: { id: params.sessionId },
      data: {
        secondaryDeviceStatus: "CONNECTED",
        secondaryDeviceLastSeenAt: new Date(),
      },
    });
    return;
  }

  await prisma.proctoringEvent.create({
    data: {
      sessionId: params.sessionId,
      type: "SECONDARY_CAMERA_DISCONNECTED",
      timestamp: new Date(),
      meta: {
        advisoryOnly: true,
        source: "secondary_camera",
        reason: coarse === "ENDED" ? "interview_ended" : "disconnected",
      },
    },
  });
  markSignaled(params.sessionId, coarse === "ENDED" ? "ENDED" : "DISCONNECTED");
  await prisma.interviewSession.update({
    where: { id: params.sessionId },
    data: {
      secondaryDeviceStatus: coarse === "ENDED" ? "DISCONNECTED" : "DISCONNECTED",
      secondaryDeviceLastSeenAt: null,
    },
  });
}

/** Invalidate pairing + clear ephemeral frames when interview ends/cancels/expires. */
export async function endSecondaryCameraSession(sessionId: string): Promise<void> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      applicationId: true,
      secondaryDeviceStatus: true,
      secondaryPairToken: true,
    },
  });
  if (!session) {
    clearSecondaryRuntime(sessionId);
    return;
  }

  const prev = getLastSignaled(sessionId);
  clearSecondaryRuntime(sessionId);

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: {
      secondaryPairToken: null,
      secondaryPairExpiresAt: null,
      secondaryDeviceStatus: "DISCONNECTED",
      secondaryDeviceLastSeenAt: null,
      // keep placementConfirmed for audit? clear it
      secondaryPlacementConfirmedAt: null,
    },
  });

  if (prev === "CONNECTED" || session.secondaryDeviceStatus === "CONNECTED") {
    await prisma.proctoringEvent.create({
      data: {
        sessionId,
        type: "SECONDARY_CAMERA_DISCONNECTED",
        timestamp: new Date(),
        meta: {
          advisoryOnly: true,
          source: "secondary_camera",
          reason: "interview_ended",
        },
      },
    });
  }
}
