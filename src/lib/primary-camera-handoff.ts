/**
 * Cross-screen handoff for the primary camera MediaStream
 * (system check → consent → interview room). Browser streams cannot
 * live in React state across unmounts without stopping tracks.
 */

let held: MediaStream | null = null;
let heldDeviceId: string | null = null;

export function holdPrimaryCameraStream(
  stream: MediaStream,
  deviceId: string | null,
): void {
  if (held && held !== stream) {
    held.getTracks().forEach((t) => t.stop());
  }
  held = stream;
  heldDeviceId = deviceId;
}

export function peekPrimaryCameraStream(): MediaStream | null {
  return held;
}

export function takePrimaryCameraStream(): {
  stream: MediaStream;
  deviceId: string | null;
} | null {
  if (!held) return null;
  const stream = held;
  const deviceId = heldDeviceId;
  held = null;
  heldDeviceId = null;
  return { stream, deviceId };
}

export function discardPrimaryCameraStream(): void {
  held?.getTracks().forEach((t) => t.stop());
  held = null;
  heldDeviceId = null;
}
