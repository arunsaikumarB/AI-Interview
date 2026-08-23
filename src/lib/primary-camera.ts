/**
 * Primary laptop camera helpers — preview + recording diagnostics.
 * Does not touch secondary-camera / #15 device interaction.
 */

export type PrimaryCameraUiStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "previewing"
  | "lost"
  | "unavailable"
  | "denied";

export type PrimaryRecordingUiStatus =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "saved"
  | "failed"
  | "skipped";

export const PRIMARY_CAMERA_LOG = {
  READY: "PRIMARY_CAMERA_READY",
  PREVIEW_STARTED: "PRIMARY_CAMERA_PREVIEW_STARTED",
  RECORDING_STARTED: "PRIMARY_CAMERA_RECORDING_STARTED",
  RECORDING_DATA: "PRIMARY_CAMERA_RECORDING_DATA",
  RECORDING_STOPPED: "PRIMARY_CAMERA_RECORDING_STOPPED",
  RECORDING_SAVED: "PRIMARY_CAMERA_RECORDING_SAVED",
  ERROR: "PRIMARY_CAMERA_ERROR",
} as const;

export function logPrimaryCamera(
  event: string,
  detail?: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "production") return;
  if (detail) console.info(`[${event}]`, detail);
  else console.info(`[${event}]`);
}

export function primaryCameraConstraint(deviceId?: string | null): MediaTrackConstraints {
  if (deviceId) {
    return { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } };
  }
  return { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };
}

export function videoTrackLive(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  const track = stream.getVideoTracks()[0];
  return Boolean(track && track.readyState === "live" && track.enabled);
}

export function pickVideoDeviceId(stream: MediaStream): string | null {
  return stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
}

export async function resolvePreferredVideoDeviceId(
  preferred: string | null | undefined,
): Promise<string | null> {
  if (!preferred || !navigator.mediaDevices?.enumerateDevices) return preferred ?? null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const stillThere = devices.some(
      (d) => d.kind === "videoinput" && d.deviceId === preferred,
    );
    return stillThere ? preferred : null;
  } catch {
    return preferred ?? null;
  }
}

export function classifyGetUserMediaError(err: unknown): PrimaryCameraUiStatus {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "unavailable";
  if (name === "NotReadableError" || name === "TrackStartError") return "lost";
  return "unavailable";
}

/** Map legacy interview labels → thinking-orbs (tests / diagnostics). Prefer InterviewThinkingOrbState. */
export type ThinkingOrbPackageState =
  | "working"
  | "searching"
  | "solving"
  | "listening"
  | "connecting"
  | "weaving"
  | "composing"
  | "breathing"
  | "shaping";

/** @deprecated Use deriveInterviewThinkingOrbState — product mapping is only breathing|composing|connecting. */
export function mapInterviewOrbToThinkingOrb(
  state:
    | "IDLE"
    | "THINKING"
    | "AI_SPEAKING"
    | "CANDIDATE_LISTENING"
    | "CANDIDATE_SPEAKING"
    | "PROCESSING"
    | "COMPLETED"
    | "breathing"
    | "listening"
    | "composing"
    | "connecting",
): { state: ThinkingOrbPackageState; paused: boolean; speed: number } {
  if (state === "breathing" || state === "AI_SPEAKING" || state === "IDLE" || state === "COMPLETED") {
    return { state: "breathing", paused: state === "COMPLETED", speed: 0.45 };
  }
  if (state === "listening" || state === "CANDIDATE_LISTENING" || state === "CANDIDATE_SPEAKING") {
    return { state: "listening", paused: false, speed: 0.45 };
  }
  if (state === "composing") {
    return { state: "composing", paused: false, speed: 0.45 };
  }
  return { state: "connecting", paused: false, speed: 0.45 };
}

export const PRIMARY_CAMERA_DEVICE_KEY = "aros-primary-camera-device";
export const PRIMARY_CAMERA_SKIPPED_KEY = "aros-primary-camera-skipped";

export function readStoredPrimaryDeviceId(token: string): string | null {
  try {
    return sessionStorage.getItem(`${PRIMARY_CAMERA_DEVICE_KEY}-${token}`);
  } catch {
    return null;
  }
}

export function storePrimaryDeviceId(token: string, deviceId: string | null): void {
  try {
    const key = `${PRIMARY_CAMERA_DEVICE_KEY}-${token}`;
    if (deviceId) sessionStorage.setItem(key, deviceId);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function storePrimaryCameraSkipped(token: string, skipped: boolean): void {
  try {
    const key = `${PRIMARY_CAMERA_SKIPPED_KEY}-${token}`;
    if (skipped) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readPrimaryCameraSkipped(token: string): boolean {
  try {
    return sessionStorage.getItem(`${PRIMARY_CAMERA_SKIPPED_KEY}-${token}`) === "1";
  } catch {
    return false;
  }
}

/** Never treat empty / failed artifacts as a successful primary recording. */
export function isHonestPrimaryRecordingSave(meta: {
  status?: string;
  ok?: boolean;
  byteLength?: number | null;
}): boolean {
  return (
    meta.ok === true &&
    meta.status === "SAVED" &&
    typeof meta.byteLength === "number" &&
    meta.byteLength > 0
  );
}

/** Stable identity for “did this UI change recreate the camera?” checks. */
export function shouldRecreatePrimaryCamera(prev: {
  enabled: boolean;
  token: string;
  preferredDeviceId: string | null;
  record: boolean;
}, next: typeof prev): boolean {
  return (
    prev.enabled !== next.enabled ||
    prev.token !== next.token ||
    prev.preferredDeviceId !== next.preferredDeviceId ||
    prev.record !== next.record
  );
}

