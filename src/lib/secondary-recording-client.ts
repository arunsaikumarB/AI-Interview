/** Client-safe recording constants (no Node fs). */

export const CHUNK_TIMESLICE_MS = 2_000;
export const MAX_PENDING_CLIENT_CHUNKS = 8;

/** Cap capture at 1080p so phones do not open 4K and overload encoding/upload. */
export const RECORDING_MAX_WIDTH = 1920;
export const RECORDING_MAX_HEIGHT = 1080;
export const RECORDING_MAX_FPS = 24;
export const RECORDING_VIDEO_BITRATE = 2_500_000;
export const RECORDING_AUDIO_BITRATE = 96_000;

export function secondaryCameraVideoConstraints(): MediaTrackConstraints {
  return {
    facingMode: { ideal: "environment" },
    width: { ideal: RECORDING_MAX_WIDTH, max: RECORDING_MAX_WIDTH },
    height: { ideal: RECORDING_MAX_HEIGHT, max: RECORDING_MAX_HEIGHT },
    frameRate: { ideal: RECORDING_MAX_FPS, max: 30 },
  };
}

export async function capSecondaryCameraTo1080p(
  stream: MediaStream,
): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track?.applyConstraints) return;
  try {
    await track.applyConstraints({
      width: { max: RECORDING_MAX_WIDTH },
      height: { max: RECORDING_MAX_HEIGHT },
      frameRate: { max: 30 },
    });
  } catch {
    /* some browsers reject exact caps; getUserMedia ideal still applies */
  }
}
