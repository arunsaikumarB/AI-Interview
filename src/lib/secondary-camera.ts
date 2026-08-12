import { randomBytes } from "crypto";

/**
 * Enhanced secondary-camera runtime (Step 4B).
 * Frames + heartbeat live in memory only — never disk / never DB blobs.
 */

export const PAIR_TTL_MS = 15 * 60 * 1000;
/** Heartbeat older than this → DISCONNECTED (≈3 missed 5s beats). */
export const HEARTBEAT_STALE_MS = 15_000;
/** Connected but no fresh frame → STALE (jitter-tolerant). */
export const FRAME_STALE_MS = 4_000;
/** Drop memory frame if older than this. */
export const FRAME_KEEP_MS = 8_000;
export const MAX_FRAME_BYTES = 350_000;
/** ~1.4–2 FPS target; hard ceiling rejects abuse. */
export const MAX_FRAMES_PER_SEC = 3;
export const MAX_HEARTBEATS_PER_SEC = 2;

export type SecondaryRuntimeStatus =
  | "NONE"
  | "WAITING"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "STALE"
  | "DISCONNECTED"
  | "ENDED";

type LiveSession = {
  sessionId: string;
  lastHeartbeatAt: number;
  lastFrameAt: number;
  mime: string | null;
  data: Buffer | null;
  frameWindowStart: number;
  framesInWindow: number;
  hbWindowStart: number;
  hbInWindow: number;
  /** Last coarse status we persisted / signaled (for transition-only events). */
  lastSignaled: "NONE" | "WAITING" | "CONNECTED" | "DISCONNECTED" | "ENDED";
  reconnectCount: number;
  hadConnected: boolean;
};

const live = new Map<string, LiveSession>();

function ensure(sessionId: string): LiveSession {
  let s = live.get(sessionId);
  if (!s) {
    s = {
      sessionId,
      lastHeartbeatAt: 0,
      lastFrameAt: 0,
      mime: null,
      data: null,
      frameWindowStart: Date.now(),
      framesInWindow: 0,
      hbWindowStart: Date.now(),
      hbInWindow: 0,
      lastSignaled: "NONE",
      reconnectCount: 0,
      hadConnected: false,
    };
    live.set(sessionId, s);
  }
  return s;
}

export function createSecondaryPairToken(): string {
  return randomBytes(24).toString("hex");
}

export function pairExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + PAIR_TTL_MS);
}

export function touchHeartbeat(sessionId: string): {
  ok: true;
  reconnect: boolean;
} | { ok: false; error: string } {
  const s = ensure(sessionId);
  const now = Date.now();
  if (now - s.hbWindowStart >= 1000) {
    s.hbWindowStart = now;
    s.hbInWindow = 0;
  }
  s.hbInWindow += 1;
  if (s.hbInWindow > MAX_HEARTBEATS_PER_SEC) {
    return { ok: false, error: "Heartbeat rate limit" };
  }
  const wasStale =
    s.hadConnected &&
    (s.lastHeartbeatAt === 0 || now - s.lastHeartbeatAt > HEARTBEAT_STALE_MS);
  s.lastHeartbeatAt = now;
  if (wasStale) s.reconnectCount += 1;
  return { ok: true, reconnect: wasStale };
}

export function putLiveFrame(params: {
  sessionId: string;
  mime: string;
  data: Buffer;
}): { ok: true } | { ok: false; error: string } {
  if (params.data.length === 0 || params.data.length > MAX_FRAME_BYTES) {
    return { ok: false, error: "Frame too large or empty" };
  }
  const s = ensure(params.sessionId);
  const now = Date.now();
  if (now - s.frameWindowStart >= 1000) {
    s.frameWindowStart = now;
    s.framesInWindow = 0;
  }
  s.framesInWindow += 1;
  if (s.framesInWindow > MAX_FRAMES_PER_SEC) {
    return { ok: false, error: "Frame rate limit" };
  }
  // Replace previous buffer reference — only latest retained.
  s.data = params.data;
  s.mime = params.mime.startsWith("image/") ? params.mime : "image/jpeg";
  s.lastFrameAt = now;
  s.lastHeartbeatAt = now;
  s.hadConnected = true;
  return { ok: true };
}

export function getLiveFrame(sessionId: string): {
  mime: string;
  data: Buffer;
  ageMs: number;
} | null {
  const s = live.get(sessionId);
  if (!s?.data || !s.mime || !s.lastFrameAt) return null;
  const ageMs = Date.now() - s.lastFrameAt;
  if (ageMs > FRAME_KEEP_MS) {
    s.data = null;
    s.mime = null;
    return null;
  }
  return { mime: s.mime, data: s.data, ageMs };
}

export function clearLiveFrame(sessionId: string): void {
  const s = live.get(sessionId);
  if (!s) return;
  s.data = null;
  s.mime = null;
  s.lastFrameAt = 0;
}

export function clearSecondaryRuntime(sessionId: string): void {
  live.delete(sessionId);
}

export function getRuntimeDiagnostics(sessionId: string) {
  const s = live.get(sessionId);
  if (!s) {
    return {
      lastFrameAgeMs: null as number | null,
      lastHeartbeatAgeMs: null as number | null,
      reconnectCount: 0,
      hasFrame: false,
    };
  }
  const now = Date.now();
  return {
    lastFrameAgeMs: s.lastFrameAt ? now - s.lastFrameAt : null,
    lastHeartbeatAgeMs: s.lastHeartbeatAt ? now - s.lastHeartbeatAt : null,
    reconnectCount: s.reconnectCount,
    hasFrame: Boolean(s.data),
  };
}

export function markSignaled(
  sessionId: string,
  status: LiveSession["lastSignaled"],
): void {
  ensure(sessionId).lastSignaled = status;
}

export function getLastSignaled(sessionId: string): LiveSession["lastSignaled"] {
  return live.get(sessionId)?.lastSignaled ?? "NONE";
}

/**
 * Resolve UI/runtime status from DB coarse fields + ephemeral freshness.
 * Never invents "cheating" semantics.
 */
export function resolveSecondaryStatus(params: {
  stored: string;
  interviewStatus: string;
  pairExpiresAt: Date | null | undefined;
  sessionId: string;
  now?: Date;
}): SecondaryRuntimeStatus {
  const now = params.now ?? new Date();
  if (
    params.interviewStatus === "COMPLETED" ||
    params.interviewStatus === "CANCELLED"
  ) {
    return "ENDED";
  }
  if (
    params.pairExpiresAt &&
    params.pairExpiresAt.getTime() < now.getTime()
  ) {
    if (params.stored === "NONE" || params.stored === "WAITING") {
      return params.stored === "WAITING" ? "DISCONNECTED" : "NONE";
    }
    return "DISCONNECTED";
  }

  const s = live.get(params.sessionId);
  const hbAge = s?.lastHeartbeatAt ? now.getTime() - s.lastHeartbeatAt : null;
  const frameAge = s?.lastFrameAt ? now.getTime() - s.lastFrameAt : null;

  if (params.stored === "WAITING" && (!s || !s.hadConnected)) {
    return "WAITING";
  }

  if (params.stored === "NONE" && (!s || !s.hadConnected)) {
    return "NONE";
  }

  // Explicit host/phone disconnect with no fresh heartbeat.
  if (params.stored === "DISCONNECTED" && (hbAge == null || hbAge > HEARTBEAT_STALE_MS)) {
    return "DISCONNECTED";
  }

  if (hbAge == null || hbAge > HEARTBEAT_STALE_MS) {
    return s?.hadConnected || params.stored === "CONNECTED"
      ? "DISCONNECTED"
      : params.stored === "WAITING"
        ? "WAITING"
        : "DISCONNECTED";
  }

  // Heartbeat alive.
  if (frameAge == null) {
    return s?.hadConnected ? "RECONNECTING" : "CONNECTING";
  }
  if (frameAge > FRAME_STALE_MS) {
    return "STALE";
  }
  return "CONNECTED";
}

/** Human-readable status — never expose raw enum to users. */
export function secondaryStatusLabel(status: SecondaryRuntimeStatus): string {
  switch (status) {
    case "CONNECTED":
      return "Secondary camera connected";
    case "CONNECTING":
      return "Connecting secondary camera…";
    case "WAITING":
      return "Waiting for secondary device…";
    case "RECONNECTING":
      return "Reconnecting secondary camera…";
    case "STALE":
      return "Secondary camera connection interrupted";
    case "DISCONNECTED":
      return "Secondary camera disconnected";
    case "ENDED":
      return "Interview ended";
    default:
      return "Secondary camera not paired yet";
  }
}

/** Sweep abandoned memory entries (pairing expired / idle). */
export function sweepSecondaryRuntime(maxIdleMs = 30 * 60 * 1000): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, s] of Array.from(live.entries())) {
    const last = Math.max(s.lastHeartbeatAt, s.lastFrameAt);
    if (!last || now - last > maxIdleMs) {
      live.delete(id);
      removed += 1;
    }
  }
  return removed;
}
