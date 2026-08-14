import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import {
  allowChunkUpload,
  finalizeRecordingFile,
  listChunkIndexes,
  newSecondaryRecordingId,
  saveRecordingChunk,
} from "@/lib/secondary-recording";
import { recordingStatusLabel } from "@/lib/secondary-recording-labels";
import { resolveStoragePath } from "@/lib/storage";

/**
 * Start recording metadata when interview is IN_PROGRESS + placement + consent.
 * Idempotent if already RECORDING/INTERRUPTED with same id.
 */
export async function startSecondaryRecording(sessionId: string): Promise<{
  recordingId: string;
  status: string;
  alreadyStarted: boolean;
}> {
  const session = await prisma.interviewSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      status: true,
      secondaryPlacementConfirmedAt: true,
      secondaryRecordingConsentAt: true,
      secondaryRecordingId: true,
      secondaryRecordingStatus: true,
      proctoringMode: true,
    },
  });

  if (session.proctoringMode !== "ENHANCED") {
    throw new Error("NOT_ENHANCED");
  }
  if (!session.secondaryRecordingConsentAt) {
    throw new Error("NO_RECORDING_CONSENT");
  }
  if (!session.secondaryPlacementConfirmedAt) {
    throw new Error("NO_PLACEMENT");
  }
  if (session.status !== "IN_PROGRESS") {
    throw new Error("NOT_IN_PROGRESS");
  }

  if (
    session.secondaryRecordingId &&
    (session.secondaryRecordingStatus === "RECORDING" ||
      session.secondaryRecordingStatus === "INTERRUPTED")
  ) {
    return {
      recordingId: session.secondaryRecordingId,
      status: session.secondaryRecordingStatus,
      alreadyStarted: true,
    };
  }

  if (session.secondaryRecordingStatus === "SAVED") {
    throw new Error("ALREADY_SAVED");
  }

  const recordingId = newSecondaryRecordingId();
  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: {
      secondaryRecordingId: recordingId,
      secondaryRecordingStatus: "RECORDING",
      secondaryRecordingStartedAt: new Date(),
      secondaryRecordingEndedAt: null,
      secondaryRecordingPath: null,
      secondaryRecordingLastChunkIndex: -1,
      secondaryRecordingInterruptedMs: 0,
      secondaryRecordingHasGap: false,
      secondaryRecordingDurationMs: null,
    },
  });

  return { recordingId, status: "RECORDING", alreadyStarted: false };
}

export async function ingestSecondaryChunk(params: {
  sessionId: string;
  recordingId: string;
  chunkIndex: number;
  data: Buffer;
  mime?: string;
}): Promise<{ stored: boolean; duplicate: boolean; status: string }> {
  if (!allowChunkUpload(params.sessionId)) {
    throw new Error("RATE_LIMIT");
  }

  const session = await prisma.interviewSession.findUniqueOrThrow({
    where: { id: params.sessionId },
    select: {
      status: true,
      secondaryRecordingId: true,
      secondaryRecordingStatus: true,
      secondaryRecordingLastChunkIndex: true,
      secondaryRecordingMime: true,
    },
  });

  if (session.secondaryRecordingId !== params.recordingId) {
    throw new Error("RECORDING_MISMATCH");
  }
  if (
    session.secondaryRecordingStatus !== "RECORDING" &&
    session.secondaryRecordingStatus !== "INTERRUPTED"
  ) {
    throw new Error("NOT_ACCEPTING_CHUNKS");
  }
  if (
    session.status !== "IN_PROGRESS" &&
    session.status !== "COMPLETED" &&
    session.status !== "TERMINATED"
  ) {
    // Allow a few trailing chunks after end while finalizing
    if (session.status === "CANCELLED") throw new Error("ENDED");
  }

  const { alreadyExisted } = await saveRecordingChunk({
    sessionId: params.sessionId,
    recordingId: params.recordingId,
    chunkIndex: params.chunkIndex,
    data: params.data,
  });

  if (alreadyExisted) {
    return {
      stored: false,
      duplicate: true,
      status: session.secondaryRecordingStatus,
    };
  }

  const nextLast = Math.max(
    session.secondaryRecordingLastChunkIndex,
    params.chunkIndex,
  );

  await prisma.interviewSession.update({
    where: { id: params.sessionId },
    data: {
      secondaryRecordingLastChunkIndex: nextLast,
      secondaryRecordingStatus: "RECORDING",
      ...(params.mime && !session.secondaryRecordingMime
        ? { secondaryRecordingMime: params.mime }
        : {}),
    },
  });

  return { stored: true, duplicate: false, status: "RECORDING" };
}

export async function markSecondaryRecordingInterrupted(
  sessionId: string,
  gapMs: number,
): Promise<void> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: {
      secondaryRecordingStatus: true,
      secondaryRecordingInterruptedMs: true,
    },
  });
  if (!session) return;
  if (
    session.secondaryRecordingStatus !== "RECORDING" &&
    session.secondaryRecordingStatus !== "INTERRUPTED"
  ) {
    return;
  }
  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: {
      secondaryRecordingStatus: "INTERRUPTED",
      secondaryRecordingHasGap: true,
      secondaryRecordingInterruptedMs:
        session.secondaryRecordingInterruptedMs + Math.max(0, gapMs),
    },
  });
}

export async function finalizeSecondaryRecording(sessionId: string): Promise<{
  status: string;
  path: string | null;
  label: string;
}> {
  const session = await prisma.interviewSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      secondaryRecordingId: true,
      secondaryRecordingStatus: true,
      secondaryRecordingLastChunkIndex: true,
      secondaryRecordingMime: true,
      secondaryRecordingStartedAt: true,
      secondaryRecordingPath: true,
    },
  });

  if (!session.secondaryRecordingId) {
    return { status: "NONE", path: null, label: recordingStatusLabel("NONE") };
  }
  if (session.secondaryRecordingStatus === "SAVED" && session.secondaryRecordingPath) {
    return {
      status: "SAVED",
      path: session.secondaryRecordingPath,
      label: recordingStatusLabel("SAVED", true),
    };
  }

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { secondaryRecordingStatus: "FINALIZING" },
  });

  try {
    let last = session.secondaryRecordingLastChunkIndex;
    let salvagedFromDisk = false;
    if (last < 0) {
      const indexes = await listChunkIndexes(
        sessionId,
        session.secondaryRecordingId,
      );
      if (indexes.length > 0) {
        last = indexes[indexes.length - 1] ?? -1;
        salvagedFromDisk = true;
      }
    }
    if (last < 0) {
      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
          secondaryRecordingStatus: "INTERRUPTED",
          secondaryRecordingEndedAt: new Date(),
        },
      });
      return {
        status: "INTERRUPTED",
        path: null,
        label: recordingStatusLabel("INTERRUPTED"),
      };
    }

    const { relativePath, byteLength } = await finalizeRecordingFile({
      sessionId,
      recordingId: session.secondaryRecordingId,
      lastChunkIndex: last,
      mime: session.secondaryRecordingMime,
    });

    if (byteLength <= 0) {
      await prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
          secondaryRecordingStatus: "FAILED",
          secondaryRecordingEndedAt: new Date(),
        },
      });
      return {
        status: "FAILED",
        path: null,
        label: recordingStatusLabel("FAILED"),
      };
    }

    const endedAt = new Date();
    const durationMs = session.secondaryRecordingStartedAt
      ? endedAt.getTime() - session.secondaryRecordingStartedAt.getTime()
      : null;

    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        secondaryRecordingStatus: "SAVED",
        secondaryRecordingPath: relativePath,
        secondaryRecordingEndedAt: endedAt,
        secondaryRecordingDurationMs: durationMs,
        ...(salvagedFromDisk ? { secondaryRecordingHasGap: true } : {}),
      },
    });

    // Tiny sidecar note for honesty (not AI input)
    try {
      const notePath = resolveStoragePath(
        path.join(path.dirname(relativePath), "meta.json"),
      );
      await mkdir(path.dirname(notePath), { recursive: true });
      await writeFile(
        notePath,
        JSON.stringify(
          {
            sessionId,
            recordingId: session.secondaryRecordingId,
            finalizedAt: endedAt.toISOString(),
            lastChunkIndex: last,
            reviewOnly: true,
            noAiInput: true,
          },
          null,
          2,
        ),
      );
    } catch {
      /* optional */
    }

    return {
      status: "SAVED",
      path: relativePath,
      label: recordingStatusLabel("SAVED", true),
    };
  } catch (err) {
    console.warn(
      "[secondary-recording] finalize failed:",
      err instanceof Error ? err.message : err,
    );
    try {
      const indexes = await listChunkIndexes(
        sessionId,
        session.secondaryRecordingId,
      );
      if (indexes.length > 0) {
        const lastRetry = indexes[indexes.length - 1] ?? -1;
        const retry = await finalizeRecordingFile({
          sessionId,
          recordingId: session.secondaryRecordingId,
          lastChunkIndex: lastRetry,
          mime: session.secondaryRecordingMime,
        });
        if (retry.byteLength > 0) {
          const endedAt = new Date();
          await prisma.interviewSession.update({
            where: { id: sessionId },
            data: {
              secondaryRecordingStatus: "SAVED",
              secondaryRecordingPath: retry.relativePath,
              secondaryRecordingEndedAt: endedAt,
              secondaryRecordingHasGap: true,
              secondaryRecordingDurationMs: session.secondaryRecordingStartedAt
                ? endedAt.getTime() -
                  session.secondaryRecordingStartedAt.getTime()
                : null,
            },
          });
          return {
            status: "SAVED",
            path: retry.relativePath,
            label: recordingStatusLabel("SAVED", true),
          };
        }
      }
    } catch {
      /* fall through to FAILED */
    }
    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        secondaryRecordingStatus: "FAILED",
        secondaryRecordingEndedAt: new Date(),
      },
    });
    return {
      status: "FAILED",
      path: null,
      label: recordingStatusLabel("FAILED"),
    };
  }
}
