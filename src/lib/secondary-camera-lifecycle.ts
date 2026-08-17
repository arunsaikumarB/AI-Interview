import { prisma } from "@/lib/db";
import {
  clearSecondaryRuntime,
  getLastSignaled,
  markSignaled,
  type SecondaryRuntimeStatus,
} from "@/lib/secondary-camera";
import { shouldPersistSecondaryCameraSignal } from "@/lib/secondary-camera-signals";

export {
  collapseConsecutiveSecondaryLinkEvents,
  shouldPersistSecondaryCameraSignal,
} from "@/lib/secondary-camera-signals";

const LINK_EVENT_TYPES = [
  "SECONDARY_CAMERA_CONNECTED",
  "SECONDARY_CAMERA_DISCONNECTED",
] as const;

async function lastPersistedLinkState(
  tx: { proctoringEvent: typeof prisma.proctoringEvent },
  sessionId: string,
): Promise<"CONNECTED" | "DISCONNECTED" | null> {
  const last = await tx.proctoringEvent.findFirst({
    where: {
      sessionId,
      type: { in: [...LINK_EVENT_TYPES] },
    },
    orderBy: [{ timestamp: "desc" }, { createdAt: "desc" }],
    select: { type: true },
  });
  if (last?.type === "SECONDARY_CAMERA_CONNECTED") return "CONNECTED";
  if (last?.type === "SECONDARY_CAMERA_DISCONNECTED") return "DISCONNECTED";
  return null;
}

/**
 * Persist transition-only secondary camera signals (never every heartbeat/frame).
 * Durable against Next.js reloads and concurrent connect polls: last connect/disconnect
 * in the database is the source of truth, not in-memory lastSignaled.
 * Does not touch AI scores or application stage.
 */
export async function signalSecondaryTransition(params: {
  sessionId: string;
  applicationId: string;
  next: SecondaryRuntimeStatus;
}): Promise<void> {
  const prev = getLastSignaled(params.sessionId);
  if (
    params.next !== "CONNECTED" &&
    params.next !== "DISCONNECTED" &&
    params.next !== "ENDED"
  ) {
    return;
  }

  if (params.next === "CONNECTED" && prev === "CONNECTED") return;
  if (
    params.next === "DISCONNECTED" &&
    (prev === "DISCONNECTED" || prev === "ENDED")
  ) {
    return;
  }
  if (params.next === "ENDED" && prev === "ENDED") return;

  const coarse = params.next;

  const persistAs: "CONNECTED" | "DISCONNECTED" =
    coarse === "CONNECTED" ? "CONNECTED" : "DISCONNECTED";

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InterviewSession" WHERE id = ${params.sessionId} FOR UPDATE`;
    const lastPersisted = await lastPersistedLinkState(tx, params.sessionId);
    if (!shouldPersistSecondaryCameraSignal({ next: persistAs, lastPersisted })) {
      markSignaled(
        params.sessionId,
        persistAs === "CONNECTED" ? "CONNECTED" : coarse === "ENDED" ? "ENDED" : "DISCONNECTED",
      );
      return;
    }

    if (persistAs === "CONNECTED") {
      await tx.proctoringEvent.create({
        data: {
          sessionId: params.sessionId,
          type: "SECONDARY_CAMERA_CONNECTED",
          timestamp: new Date(),
          meta: { advisoryOnly: true, source: "secondary_camera" },
        },
      });
      markSignaled(params.sessionId, "CONNECTED");
      await tx.interviewSession.update({
        where: { id: params.sessionId },
        data: {
          secondaryDeviceStatus: "CONNECTED",
          secondaryDeviceLastSeenAt: new Date(),
        },
      });
      return;
    }

    await tx.proctoringEvent.create({
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
    await tx.interviewSession.update({
      where: { id: params.sessionId },
      data: {
        secondaryDeviceStatus: "DISCONNECTED",
        secondaryDeviceLastSeenAt: null,
      },
    });
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
    await signalSecondaryTransition({
      sessionId,
      applicationId: session.applicationId,
      next: "ENDED",
    });
  }
}
