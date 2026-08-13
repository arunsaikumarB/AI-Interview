/** Client-safe secondary recording labels (no Node fs). */

/** Recruiter-facing state. Stored DB values stay backward-compatible. */
export function recruiterRecordingState(
  status: string,
  hasPath: boolean,
):
  | "NOT_ENABLED"
  | "WAITING"
  | "RECORDING"
  | "FINALIZING"
  | "READY"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "INCOMPLETE" {
  if (hasPath && (status === "SAVED" || status === "READY")) return "READY";
  if (status === "RECORDING") return "RECORDING";
  if (status === "FINALIZING") return "FINALIZING";
  if (status === "FAILED") return "FAILED";
  if (status === "DISCARDED") return "CANCELLED";
  if (status === "INTERRUPTED") return hasPath ? "READY" : "INCOMPLETE";
  if (status === "READY" && !hasPath) return "WAITING";
  if (status === "NONE") return "NOT_ENABLED";
  return hasPath ? "READY" : "NOT_ENABLED";
}

export function recordingStatusLabel(status: string, hasPath = false): string {
  const state = recruiterRecordingState(status, hasPath);
  switch (state) {
    case "READY":
      return "Recording available";
    case "RECORDING":
      return "Recording in progress";
    case "FINALIZING":
      return "Saving recording…";
    case "FAILED":
      return "Recording could not be finalized";
    case "INCOMPLETE":
      return "Recording incomplete";
    case "WAITING":
      return "Waiting to record";
    case "CANCELLED":
      return "Recording cancelled";
    case "EXPIRED":
      return "Recording expired";
    default:
      return "Secondary camera recording unavailable";
  }
}
