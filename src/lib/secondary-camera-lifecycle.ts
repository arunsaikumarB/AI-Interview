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
  const rec = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: {
      secondaryRecordingId: true,
      secondaryRecordingPath: true,
      secondaryRecordingStatus: true,
      secondaryRecordingLastChunkIndex: true,
      secondaryPairExpiresAt: true,
    },
  });

  const hasChunks = (rec?.secondaryRecordingLastChunkIndex ?? -1) >= 0;
  const keepPairForFlush =
    Boolean(rec?.secondaryRecordingId) &&
    !rec?.secondaryRecordingPath &&
    rec?.secondaryRecordingStatus !== "SAVED" &&
    rec?.secondaryRecordingStatus !== "DISCARDED";

  if (hasChunks) {
    try {
      const { finalizeSecondaryRecording } = await import(
        "@/lib/secondary-recording-server"
      );
      await finalizeSecondaryRecording(sessionId);
    } catch (err) {
      console.warn(
        "[secondary-recording] finalize on end failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

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

  const flushUntil = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: {
      ...(keepPairForFlush
        ? { secondaryPairExpiresAt: flushUntil }
        : {
            secondaryPairToken: null,
            secondaryPairExpiresAt: null,
          }),
      secondaryDeviceStatus: "DISCONNECTED",
      secondaryDeviceLastSeenAt: null,
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
