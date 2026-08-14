/**
 * Secondary camera orientation helpers.
 * Capture records the camera track as-is. Recruiter review playback
 * applies CSS rotation so existing sideways files display upright.
 */

export function cameraBufferNeedsPortraitRotate(video: HTMLVideoElement): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 16 || vh < 16) return false;
  const displayPortrait =
    typeof window !== "undefined" && window.innerHeight > window.innerWidth + 40;
  return displayPortrait && vw > vh;
}

export function createOrientedRecordStream(
  _video?: HTMLVideoElement,
  _cameraStream?: MediaStream,
): { stream: MediaStream; stop: () => void } | null {
  void _video;
  void _cameraStream;
  // Canvas bake previously produced portrait files with the person still on
  // their side. Record the camera track as-is; review playback straightens it.
  return null;
}

export function displayOrientationLabel(): "portrait" | "landscape" {
  if (typeof window === "undefined") return "landscape";
  return window.innerHeight > window.innerWidth ? "portrait" : "landscape";
}
