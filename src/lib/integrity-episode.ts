/**
 * Client-side focus-loss episode grouping for Strict integrity.
 * Multiple blur/visibility events while away = one episode when the candidate returns.
 */

import { STRICT_POLICY } from "@/lib/integrity";

export type IntegrityEpisodeController = {
  onLoss: () => void;
  onReturn: () => void;
  reportImmediate: (
    kind: "FULLSCREEN_EXIT" | "PASTE",
    meta?: { pastedLength?: number },
  ) => void;
  dispose: () => void;
};

export function createIntegrityEpisodeController(params: {
  token: string;
  enabled: boolean;
  onResult: (result: {
    terminated: boolean;
    showWarning: boolean;
    warningNumber: number;
    warningOf: number;
    kind: "FOCUS_LOSS" | "FULLSCREEN_EXIT" | "PASTE";
  }) => void;
}): IntegrityEpisodeController {
  let episodeOpen = false;
  let episodeId: string | null = null;
  let disposed = false;
  let inFlight = false;

  async function post(
    kind: "FOCUS_LOSS" | "FULLSCREEN_EXIT" | "PASTE",
    opts?: { episodeId?: string; pastedLength?: number },
  ) {
    if (!params.enabled || disposed || inFlight) return;
    inFlight = true;
    try {
      const res = await fetch(
        `/api/interview/${params.token}/integrity/violation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            timestamp: new Date().toISOString(),
            episodeId: opts?.episodeId,
            pastedLength: opts?.pastedLength,
          }),
          keepalive: true,
        },
      );
      const data = (await res.json()) as {
        terminated?: boolean;
        showWarning?: boolean;
        warningNumber?: number;
        warningOf?: number;
      };
      if (!res.ok) return;
      params.onResult({
        terminated: Boolean(data.terminated),
        showWarning: Boolean(data.showWarning),
        warningNumber: data.warningNumber ?? 1,
        warningOf: data.warningOf ?? STRICT_POLICY.focusTerminateAt,
        kind,
      });
    } catch {
      /* best-effort */
    } finally {
      inFlight = false;
    }
  }

  function onLoss() {
    if (!params.enabled || disposed) return;
    if (episodeOpen) return;
    episodeOpen = true;
    episodeId = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function onReturn() {
    if (!params.enabled || disposed) return;
    if (!episodeOpen || !episodeId) {
      episodeOpen = false;
      episodeId = null;
      return;
    }
    const id = episodeId;
    episodeOpen = false;
    episodeId = null;
    void post("FOCUS_LOSS", { episodeId: id });
  }

  function reportImmediate(
    kind: "FULLSCREEN_EXIT" | "PASTE",
    meta?: { pastedLength?: number },
  ) {
    if (!params.enabled || disposed) return;
    const id = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    void post(kind, { episodeId: id, pastedLength: meta?.pastedLength });
  }

  function dispose() {
    disposed = true;
    episodeOpen = false;
    episodeId = null;
  }

  return { onLoss, onReturn, reportImmediate, dispose };
}
