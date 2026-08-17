/**
 * Transition-only secondary camera link events.
 * Pure helpers — safe for client UI. Persistence lives in secondary-camera-lifecycle.
 */

export function shouldPersistSecondaryCameraSignal(params: {
  next: "CONNECTED" | "DISCONNECTED";
  lastPersisted: "CONNECTED" | "DISCONNECTED" | null;
}): boolean {
  if (params.next === "CONNECTED") {
    return params.lastPersisted !== "CONNECTED";
  }
  return params.lastPersisted === "CONNECTED";
}

/**
 * Collapse duplicate connect/disconnect rows in recruiter UI.
 * One CONNECTED stands until a DISCONNECTED (and the reverse), even if
 * other integrity signals sit between them. Does not drop those signals.
 */
export function collapseConsecutiveSecondaryLinkEvents<
  T extends { type: string },
>(events: T[]): T[] {
  const out: T[] = [];
  let lastLink: string | null = null;
  for (const e of events) {
    const isLink =
      e.type === "SECONDARY_CAMERA_CONNECTED" ||
      e.type === "SECONDARY_CAMERA_DISCONNECTED";
    if (isLink) {
      if (e.type === lastLink) continue;
      lastLink = e.type;
    }
    out.push(e);
  }
  return out;
}
