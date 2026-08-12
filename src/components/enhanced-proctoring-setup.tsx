"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PairStatus =
  | "NONE"
  | "WAITING"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "STALE"
  | "DISCONNECTED"
  | "ENDED";

type StatusPayload = {
  status: PairStatus;
  label?: string;
  pairUrl: string | null;
  pairToken?: string | null;
  pairExpiresAt: string | null;
  placementConfirmed: boolean;
  livePreviewAvailable?: boolean;
  diagnostics?: {
    lastFrameAgeMs: number | null;
    lastHeartbeatAgeMs: number | null;
    reconnectCount: number;
    hasFrame: boolean;
  };
};

function statusTone(status: PairStatus): string {
  if (status === "CONNECTED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "STALE" || status === "RECONNECTING" || status === "CONNECTING") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  if (status === "DISCONNECTED" || status === "ENDED") {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-800";
}

/**
 * Host Enhanced Proctoring setup — QR + live preview + confirm.
 * Evidence-only status copy (never cheating claims).
 */
export function EnhancedProctoringSetup({
  token,
  onReady,
}: {
  token: string;
  onReady: () => void;
}) {
  const [status, setStatus] = useState<PairStatus>("NONE");
  const [label, setLabel] = useState("Secondary camera not paired yet");
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [placementConfirmed, setPlacementConfirmed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localhostWarn, setLocalhostWarn] = useState(false);
  const [diag, setDiag] = useState<StatusPayload["diagnostics"] | null>(null);

  const showDiag =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("diag") === "1";

  const refreshStatus = useCallback(async () => {
    const qs = showDiag ? "?diag=1" : "";
    const res = await fetch(`/api/interview/${token}/proctoring/secondary${qs}`);
    const data = (await res.json()) as StatusPayload & { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not load secondary camera status");
      return;
    }
    setStatus(data.status);
    setLabel(data.label ?? data.status);
    setPairUrl(data.pairUrl);
    setPlacementConfirmed(Boolean(data.placementConfirmed));
    setDiag(data.diagnostics ?? null);
    if (data.pairUrl) {
      const qr = await QRCode.toDataURL(data.pairUrl, {
        margin: 1,
        width: 240,
        color: { dark: "#0f172a", light: "#ffffff" },
      });
      setQrDataUrl(qr);
    }
  }, [token, showDiag]);

  useEffect(() => {
    void refreshStatus();
    const id = setInterval(() => void refreshStatus(), 2000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    const live =
      status === "CONNECTED" || status === "STALE" || status === "RECONNECTING";
    if (!live) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/interview/${token}/proctoring/secondary/frame?t=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        /* preview may lag */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 750);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status, token]);

  async function mint() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/interview/${token}/proctoring/secondary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mint" }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not create pairing code");
      return;
    }
    const origin = window.location.origin;
    const url = `${origin}/interview/secondary/${data.pairToken}`;
    setPairUrl(url);
    setStatus(data.status);
    setLabel(data.label ?? "Waiting for secondary device…");
    setPlacementConfirmed(false);
    setLocalhostWarn(
      origin.includes("localhost") || origin.includes("127.0.0.1"),
    );
    const qr = await QRCode.toDataURL(url, {
      margin: 1,
      width: 240,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    setQrDataUrl(qr);
  }

  async function confirmPlacement() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/interview/${token}/proctoring/secondary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm_placement" }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(
        data.error ??
          "Confirm placement after the secondary camera connects",
      );
      return;
    }
    setPlacementConfirmed(true);
  }

  async function disconnect() {
    setBusy(true);
    await fetch(`/api/interview/${token}/proctoring/secondary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disconnect" }),
    });
    setBusy(false);
    setPlacementConfirmed(false);
    setPreviewUrl(null);
    await refreshStatus();
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">
          Enhanced proctoring
        </p>
        <h1 className="mt-1 font-display text-3xl text-slate-900">
          Pair secondary camera
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Use a phone or tablet as a second camera angle for human review. This
          is not AI cheating detection.
        </p>
      </div>

      <div className={cn("rounded-lg border px-3 py-2 text-sm font-medium", statusTone(status))}>
        <div className="flex items-center justify-between gap-2">
          <span>Secondary Camera</span>
          {status === "CONNECTED" ? (
            <span className="text-xs font-semibold uppercase tracking-wide">
              ● Live
            </span>
          ) : status === "STALE" || status === "RECONNECTING" ? (
            <span className="text-xs font-semibold uppercase tracking-wide">
              ⚠ Interrupted
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-normal">
          {status === "CONNECTED" ? `${label} ✓` : label}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={mint} disabled={busy}>
          {pairUrl ? "Refresh QR code" : "Show QR code"}
        </Button>
        {status === "CONNECTED" ||
        status === "STALE" ||
        status === "DISCONNECTED" ||
        status === "RECONNECTING" ? (
          <Button variant="outline" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        ) : null}
      </div>

      {qrDataUrl && pairUrl ? (
        <div className="space-y-2 rounded-xl border border-slate-200 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="QR code to open secondary camera"
            className="mx-auto h-48 w-48"
          />
          <p className="break-all text-center text-xs text-slate-500">{pairUrl}</p>
          {localhostWarn ? (
            <p className="text-xs text-amber-800">
              This URL uses localhost. A phone on another device cannot open it.
              Open this interview via your LAN IP or set NEXT_PUBLIC_APP_URL,
              then refresh the QR code.
            </p>
          ) : null}
        </div>
      ) : null}

      {status === "CONNECTED" ||
      status === "STALE" ||
      status === "RECONNECTING" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-900">Live preview</p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Secondary camera live preview"
                className="aspect-video w-full object-contain bg-slate-950"
              />
            ) : (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                {status === "STALE"
                  ? "Connection interrupted — waiting for frames…"
                  : "Connected — waiting for first preview frame…"}
              </p>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Preview is ephemeral (not saved as a recording). Place the phone to
            show your desk / side view, then confirm.
          </p>
          {!placementConfirmed ? (
            <Button
              onClick={confirmPlacement}
              disabled={busy || status !== "CONNECTED"}
            >
              Confirm placement
            </Button>
          ) : (
            <p className="text-sm text-emerald-800">Placement confirmed</p>
          )}
        </div>
      ) : null}

      {showDiag && diag ? (
        <pre className="overflow-auto rounded-lg bg-slate-900 p-3 text-[10px] text-slate-100">
          {JSON.stringify(diag, null, 2)}
        </pre>
      ) : null}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Button
        className="w-full"
        disabled={!placementConfirmed || status !== "CONNECTED"}
        onClick={onReady}
      >
        Continue to interview
      </Button>
    </div>
  );
}
