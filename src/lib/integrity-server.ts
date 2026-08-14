import type { Prisma, ProctoringSignalType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { asJson } from "@/lib/ai/interview-session";
import {
  STRICT_POLICY,
  SECONDARY_INTEGRITY_POLICY,
  SECONDARY_INFO_KINDS,
  type IntegrityViolationKind,
  type SecondaryIntegrityKind,
  parseIntegrityMode,
} from "@/lib/integrity";

export type IntegrityViolationResult = {
  ok: true;
  mode: "STANDARD" | "STRICT";
  recorded: boolean;
  /** Focus/fullscreen episode count (server). */
  focusViolations: number;
  /** Paste violation count (server). */
  pasteViolations: number;
  /** Warning number for the kind just recorded (for UI “Warning N of M”). */
  warningNumber: number;
  warningOf: number;
  terminated: boolean;
  status: string;
  reason: string | null;
  showWarning: boolean;
};

/**
 * Server-authoritative Strict integrity violation recording + optional terminate.
 * Idempotent termination: concurrent calls cannot double-terminate or corrupt status.
 * Does NOT touch Application.stage. Does NOT call AI.
 */
export async function recordIntegrityViolation(params: {
  sessionId: string;
  kind: IntegrityViolationKind;
  timestamp: Date;
  meta?: Record<string, unknown>;
  episodeId?: string;
}): Promise<IntegrityViolationResult> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: params.sessionId },
    select: {
      id: true,
      status: true,
      integrityMode: true,
      integrityViolationCount: true,
      integrityPasteCount: true,
      integrityTerminatedReason: true,
      applicationId: true,
    },
  });

  if (!session) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const mode = parseIntegrityMode(session.integrityMode);
  const isPaste = params.kind === "PASTE";
  const warningOf = isPaste
    ? STRICT_POLICY.pasteTerminateAt
    : STRICT_POLICY.focusTerminateAt;

  const early = (
    overrides: Partial<IntegrityViolationResult> & {
      status: string;
    },
  ): IntegrityViolationResult => ({
    ok: true,
    mode,
    recorded: false,
    focusViolations: session.integrityViolationCount,
    pasteViolations: session.integrityPasteCount,
    warningNumber: isPaste
      ? session.integrityPasteCount
      : session.integrityViolationCount,
    warningOf,
    terminated: session.status === "TERMINATED",
    reason: session.integrityTerminatedReason,
    showWarning: false,
    ...overrides,
  });

  if (session.status === "TERMINATED") {
    return early({ status: "TERMINATED", terminated: true });
  }

  if (session.status !== "IN_PROGRESS") {
    return early({ status: session.status, terminated: false });
  }

  if (mode !== "STRICT") {
    return early({
      mode: "STANDARD",
      status: session.status,
      terminated: false,
    });
  }

  const signalType =
    params.kind === "PASTE"
      ? "COPY_PASTE"
      : params.kind === "FULLSCREEN_EXIT"
        ? "FULLSCREEN_EXIT"
        : "WINDOW_SWITCH";

  const meta: Record<string, unknown> = {
    ...(params.meta ?? {}),
    signalOnly: true,
    noAutoVerdict: true,
    integrityViolation: true,
    integrityKind: params.kind,
    ...(params.episodeId ? { episodeId: params.episodeId } : {}),
  };
  if (isPaste) {
    delete meta.content;
    delete meta.text;
    if (typeof params.meta?.pastedLength === "number") {
      meta.pastedLength = params.meta.pastedLength;
    }
  }

  if (params.episodeId) {
    const recent = await prisma.proctoringEvent.findFirst({
      where: {
        sessionId: session.id,
        timestamp: {
          gte: new Date(Date.now() - STRICT_POLICY.episodeCooldownMs * 4),
        },
      },
      orderBy: { timestamp: "desc" },
      select: { meta: true },
    });
    const recentMeta =
      recent?.meta && typeof recent.meta === "object"
        ? (recent.meta as Record<string, unknown>)
        : null;
    if (
      recentMeta?.integrityViolation === true &&
      recentMeta.episodeId === params.episodeId
    ) {
      return early({ status: session.status });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.interviewSession.findUnique({
      where: { id: session.id },
      select: {
        status: true,
        integrityViolationCount: true,
        integrityPasteCount: true,
        integrityTerminatedReason: true,
        applicationId: true,
      },
    });
    if (!fresh) throw new Error("SESSION_NOT_FOUND");
    if (fresh.status === "TERMINATED") {
      return {
        focusViolations: fresh.integrityViolationCount,
        pasteViolations: fresh.integrityPasteCount,
        terminated: true,
        reason: fresh.integrityTerminatedReason,
        showWarning: false,
        recorded: false,
        status: "TERMINATED" as const,
      };
    }
    if (fresh.status !== "IN_PROGRESS") {
      return {
        focusViolations: fresh.integrityViolationCount,
        pasteViolations: fresh.integrityPasteCount,
        terminated: false,
        reason: null,
        showWarning: false,
        recorded: false,
        status: fresh.status,
      };
    }

    const nextFocus = isPaste
      ? fresh.integrityViolationCount
      : fresh.integrityViolationCount + 1;
    const nextPaste = isPaste
      ? fresh.integrityPasteCount + 1
      : fresh.integrityPasteCount;

    const focusTerminate =
      !isPaste && nextFocus >= STRICT_POLICY.focusTerminateAt;
    const pasteTerminate =
      isPaste && nextPaste >= STRICT_POLICY.pasteTerminateAt;
    const shouldTerminate = focusTerminate || pasteTerminate;
    const reason = pasteTerminate
      ? "paste_threshold"
      : focusTerminate
        ? params.kind === "FULLSCREEN_EXIT"
          ? "fullscreen_threshold"
          : "focus_threshold"
        : null;

    await tx.proctoringEvent.create({
      data: {
        sessionId: session.id,
        type: signalType,
        timestamp: params.timestamp,
        meta: asJson(meta) as Prisma.InputJsonValue,
      },
    });

    if (shouldTerminate && reason) {
      const updated = await tx.interviewSession.updateMany({
        where: { id: session.id, status: "IN_PROGRESS" },
        data: {
          integrityViolationCount: nextFocus,
          integrityPasteCount: nextPaste,
          status: "TERMINATED",
          endedAt: new Date(),
          integrityTerminatedReason: reason,
        },
      });

      if (updated.count === 1) {
        await tx.timelineEvent.create({
          data: {
            applicationId: fresh.applicationId,
            type: "OTHER",
            payload: {
              kind: "integrity_terminated",
              sessionId: session.id,
              reason,
              focusViolations: nextFocus,
              pasteViolations: nextPaste,
              advisoryOnly: true,
              noAtsStageChange: true,
              noAiInput: true,
            },
          },
        });
      }

      const after = await tx.interviewSession.findUnique({
        where: { id: session.id },
        select: {
          status: true,
          integrityViolationCount: true,
          integrityPasteCount: true,
          integrityTerminatedReason: true,
        },
      });

      return {
        focusViolations: after?.integrityViolationCount ?? nextFocus,
        pasteViolations: after?.integrityPasteCount ?? nextPaste,
        terminated: after?.status === "TERMINATED",
        reason: after?.integrityTerminatedReason ?? reason,
        showWarning: false,
        recorded: true,
        status: (after?.status ?? "TERMINATED") as string,
      };
    }

    await tx.interviewSession.update({
      where: { id: session.id },
      data: {
        integrityViolationCount: nextFocus,
        integrityPasteCount: nextPaste,
      },
    });

    return {
      focusViolations: nextFocus,
      pasteViolations: nextPaste,
      terminated: false,
      reason: null,
      showWarning: true,
      recorded: true,
      status: "IN_PROGRESS" as const,
    };
  });

  const warningNumber = isPaste
    ? result.pasteViolations
    : result.focusViolations;

  return {
    ok: true,
    mode: "STRICT",
    recorded: result.recorded,
    focusViolations: result.focusViolations,
    pasteViolations: result.pasteViolations,
    warningNumber,
    warningOf,
    terminated: result.terminated,
    status: result.status,
    reason: result.reason,
    showWarning: result.showWarning,
  };
}

function secondarySignalType(kind: SecondaryIntegrityKind): ProctoringSignalType {
  switch (kind) {
    case "CAMERA_MOVED":
      return "SECONDARY_CAMERA_MOVED";
    case "PERSON_MISSING":
      return "SECONDARY_NO_FACE";
    case "EXTRA_PERSON":
      return "SECONDARY_MULTIPLE_PERSONS" as ProctoringSignalType;
    case "PERSON_RETURNED_TO_ONE":
      return "SECONDARY_PERSON_RETURNED_TO_ONE" as ProctoringSignalType;
    case "PERSON_INTERACTION":
      return "SECONDARY_PERSON_INTERACTION" as ProctoringSignalType;
    case "LOOKING_AT_SECONDARY":
      return "SECONDARY_LOOKING_AT_DEVICE";
    case "PERSON_MOVED":
      return "SECONDARY_PERSON_MOVED";
    case "PERSON_RETURNED":
      return "SECONDARY_PERSON_RETURNED";
    case "ATTENTION_DEVIATION":
      return "SECONDARY_ATTENTION_DEVIATION";
    case "DEVICE_VISIBLE":
      return "SECONDARY_DEVICE_VISIBLE";
    case "DEVICE_REMOVED":
      return "SECONDARY_DEVICE_REMOVED";
    case "DEVICE_INTERACTION":
      return "SECONDARY_DEVICE_INTERACTION";
  }
}

function secondaryTerminateReason(kind: SecondaryIntegrityKind): string {
  switch (kind) {
    case "CAMERA_MOVED":
      return "secondary_camera_moved";
    case "PERSON_MISSING":
      return "secondary_person_missing";
    case "EXTRA_PERSON":
      return "secondary_extra_person";
    case "LOOKING_AT_SECONDARY":
      return "secondary_looking_at_device";
    case "PERSON_MOVED":
      return "secondary_person_moved";
    case "ATTENTION_DEVIATION":
      return "secondary_attention";
    case "DEVICE_VISIBLE":
    case "DEVICE_INTERACTION":
      return "secondary_device";
    case "PERSON_INTERACTION":
      return "secondary_person_interaction";
    case "PERSON_RETURNED":
    case "PERSON_RETURNED_TO_ONE":
    case "DEVICE_REMOVED":
      return "secondary_person_missing";
  }
}

/**
 * Enhanced secondary-camera environment integrity.
 * 3 warnings the candidate must acknowledge and fix; the 4th episode ends
 * the InterviewSession only — never Application.stage, never AI prompts.
 */
export async function recordSecondaryIntegrityViolation(params: {
  sessionId: string;
  kind: SecondaryIntegrityKind;
  timestamp: Date;
  meta?: Record<string, unknown>;
  episodeId?: string;
}): Promise<IntegrityViolationResult> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: params.sessionId },
    select: {
      id: true,
      status: true,
      integrityMode: true,
      integrityViolationCount: true,
      integrityPasteCount: true,
      integrityCameraMoveCount: true,
      integrityPendingWarningKind: true,
      integrityTerminatedReason: true,
      applicationId: true,
      proctoringMode: true,
    },
  });

  if (!session) throw new Error("SESSION_NOT_FOUND");

  const mode = parseIntegrityMode(session.integrityMode);
  const warningOf = SECONDARY_INTEGRITY_POLICY.warningLimit;

  const early = (
    overrides: Partial<IntegrityViolationResult> & { status: string },
  ): IntegrityViolationResult => ({
    ok: true,
    mode,
    recorded: false,
    focusViolations: session.integrityViolationCount,
    pasteViolations: session.integrityPasteCount,
    warningNumber: Math.min(
      Math.max(session.integrityCameraMoveCount, 1),
      warningOf,
    ),
    warningOf,
    terminated: session.status === "TERMINATED",
    reason: session.integrityTerminatedReason,
    showWarning: Boolean(session.integrityPendingWarningKind),
    ...overrides,
  });

  if (session.status === "TERMINATED") {
    return early({ status: "TERMINATED", terminated: true, showWarning: false });
  }
  if (session.status !== "IN_PROGRESS") {
    return early({ status: session.status, terminated: false, showWarning: false });
  }
  if (session.proctoringMode !== "ENHANCED") {
    return early({ status: session.status, terminated: false, showWarning: false });
  }

  if (params.episodeId) {
    const recent = await prisma.proctoringEvent.findFirst({
      where: {
        sessionId: session.id,
        timestamp: {
          gte: new Date(
            Date.now() - SECONDARY_INTEGRITY_POLICY.episodeCooldownMs * 4,
          ),
        },
      },
      orderBy: { timestamp: "desc" },
      select: { meta: true },
    });
    const recentMeta =
      recent?.meta && typeof recent.meta === "object"
        ? (recent.meta as Record<string, unknown>)
        : null;
    if (
      recentMeta?.integrityViolation === true &&
      recentMeta.episodeId === params.episodeId
    ) {
      return early({ status: session.status });
    }
  }

  const infoOnly = SECONDARY_INFO_KINDS.has(params.kind);
  const meta: Record<string, unknown> = {
    ...(params.meta ?? {}),
    signalOnly: true,
    noAutoVerdict: true,
    noAtsStageChange: true,
    noAiInput: true,
    integrityViolation: !infoOnly,
    integrityInfo: infoOnly,
    integrityKind: params.kind,
    source: "secondary_camera",
    ...(params.episodeId ? { episodeId: params.episodeId } : {}),
  };

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.interviewSession.findUnique({
      where: { id: session.id },
      select: {
        status: true,
        integrityViolationCount: true,
        integrityPasteCount: true,
        integrityCameraMoveCount: true,
        integrityPendingWarningKind: true,
        integrityTerminatedReason: true,
        applicationId: true,
      },
    });
    if (!fresh) throw new Error("SESSION_NOT_FOUND");
    if (fresh.status === "TERMINATED") {
      return {
        cameraMoves: fresh.integrityCameraMoveCount,
        terminated: true,
        reason: fresh.integrityTerminatedReason,
        showWarning: false,
        recorded: false,
        status: "TERMINATED" as const,
        warningNumber: fresh.integrityCameraMoveCount,
      };
    }
    if (fresh.status !== "IN_PROGRESS") {
      return {
        cameraMoves: fresh.integrityCameraMoveCount,
        terminated: false,
        reason: null,
        showWarning: false,
        recorded: false,
        status: fresh.status,
        warningNumber: fresh.integrityCameraMoveCount,
      };
    }

    if (infoOnly) {
      await tx.proctoringEvent.create({
        data: {
          sessionId: session.id,
          type: secondarySignalType(params.kind),
          timestamp: params.timestamp,
          meta: asJson(meta) as Prisma.InputJsonValue,
        },
      });
      return {
        cameraMoves: fresh.integrityCameraMoveCount,
        terminated: false,
        reason: null,
        showWarning: false,
        recorded: true,
        status: "IN_PROGRESS" as const,
        warningNumber: Math.min(
          Math.max(fresh.integrityCameraMoveCount, 1),
          warningOf,
        ),
      };
    }

    // Popup still open — remind, do not consume another chance.
    if (fresh.integrityPendingWarningKind) {
      return {
        cameraMoves: fresh.integrityCameraMoveCount,
        terminated: false,
        reason: null,
        showWarning: true,
        recorded: false,
        status: "IN_PROGRESS" as const,
        warningNumber: Math.min(
          Math.max(fresh.integrityCameraMoveCount, 1),
          warningOf,
        ),
      };
    }

    const nextMoves = fresh.integrityCameraMoveCount + 1;
    const shouldTerminate =
      nextMoves >= SECONDARY_INTEGRITY_POLICY.terminateAt;
    const reason = shouldTerminate
      ? secondaryTerminateReason(params.kind)
      : null;

    await tx.proctoringEvent.create({
      data: {
        sessionId: session.id,
        type: secondarySignalType(params.kind),
        timestamp: params.timestamp,
        meta: asJson(meta) as Prisma.InputJsonValue,
      },
    });

    if (shouldTerminate && reason) {
      const updated = await tx.interviewSession.updateMany({
        where: { id: session.id, status: "IN_PROGRESS" },
        data: {
          integrityCameraMoveCount: nextMoves,
          integrityPendingWarningKind: null,
          status: "TERMINATED",
          endedAt: new Date(),
          integrityTerminatedReason: reason,
        },
      });
      if (updated.count === 1) {
        await tx.timelineEvent.create({
          data: {
            applicationId: fresh.applicationId,
            type: "OTHER",
            payload: {
              kind: "integrity_terminated",
              sessionId: session.id,
              reason,
              source: "secondary_camera",
              advisoryOnly: true,
              noAtsStageChange: true,
              noAiInput: true,
            },
          },
        });
      }
      const after = await tx.interviewSession.findUnique({
        where: { id: session.id },
        select: {
          status: true,
          integrityCameraMoveCount: true,
          integrityTerminatedReason: true,
        },
      });
      return {
        cameraMoves: after?.integrityCameraMoveCount ?? nextMoves,
        terminated: after?.status === "TERMINATED",
        reason: after?.integrityTerminatedReason ?? reason,
        showWarning: false,
        recorded: true,
        status: (after?.status ?? "TERMINATED") as string,
        warningNumber: after?.integrityCameraMoveCount ?? nextMoves,
      };
    }

    await tx.interviewSession.update({
      where: { id: session.id },
      data: {
        integrityCameraMoveCount: nextMoves,
        integrityPendingWarningKind: params.kind,
      },
    });

    return {
      cameraMoves: nextMoves,
      terminated: false,
      reason: null,
      showWarning: true,
      recorded: true,
      status: "IN_PROGRESS" as const,
      warningNumber: Math.min(nextMoves, warningOf),
    };
  });

  return {
    ok: true,
    mode,
    recorded: result.recorded,
    focusViolations: session.integrityViolationCount,
    pasteViolations: session.integrityPasteCount,
    warningNumber: result.warningNumber,
    warningOf,
    terminated: result.terminated,
    status: result.status,
    reason: result.reason,
    showWarning: result.showWarning,
  };
}

export async function acknowledgeSecondaryWarning(
  sessionId: string,
): Promise<{ ok: true; cleared: boolean }> {
  const updated = await prisma.interviewSession.updateMany({
    where: {
      id: sessionId,
      status: "IN_PROGRESS",
      integrityPendingWarningKind: { not: null },
    },
    data: { integrityPendingWarningKind: null },
  });
  return { ok: true, cleared: updated.count === 1 };
}
