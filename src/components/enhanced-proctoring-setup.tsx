"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";

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
  lanIp?: string | null;
  pairToken?: string | null;
  pairExpiresAt: string | null;
  placementConfirmed: boolean;
  livePreviewAvailable?: boolean;
  reachableFromPhone?: boolean;
  requiresHttpsTrust?: boolean;
  frameFresh?: boolean;
  framing?: {
    candidateVisible: boolean;
    extraPersonInPrimaryZone: boolean;
    laptopVisible: boolean;
    personCount: number;
    ageMs: number;
  } | null;
  recordingStatus?: string;
  recordingLabel?: string;
  recordingHasGap?: boolean;
  diagnostics?: {
    lastFrameAgeMs: number | null;
    lastHeartbeatAgeMs: number | null;
    reconnectCount: number;
    hasFrame: boolean;
  };
};

function statusTone(status: PairStatus): string {
  if (status === "CONNECTED") {
    return "border-ai/30 bg-ai/10 text-foreground";
  }
  if (status === "STALE" || status === "RECONNECTING" || status === "CONNECTING") {
    return "border-warning/30 bg-warning/10 text-foreground";
  }
  return "border-border bg-muted/40 text-foreground";
}

function recordingTone(status?: string): string {
  if (status === "RECORDING") return "text-ai";
  if (status === "READY" || status === "SAVED") return "text-success";
  if (status === "INTERRUPTED" || status === "FINALIZING") return "text-warning";
  if (status === "FAILED") return "text-destructive";
  return "text-muted-foreground";
}

function PlacementGuideOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 text-[10px] font-medium uppercase tracking-[0.12em] text-foreground/80"
      aria-hidden
    >
      <div className="rounded-md border border-dashed border-primary/35 bg-background/20 px-2 py-1 text-center backdrop-blur-[1px]">
        Surrounding workspace
      </div>
      <div className="mx-auto w-[55%] rounded-lg border border-primary/50 bg-background/15 px-2 py-6 text-center backdrop-blur-[1px]">
        Candidate
      </div>
      <div className="rounded-md border border-dashed border-primary/35 bg-background/20 px-2 py-1 text-center backdrop-blur-[1px]">
        Laptop / desk / keyboard
      </div>
    </div>
  );
}

/**
 * Host Enhanced Proctoring — QR + placement gate + recording status.
 */
export function EnhancedProctoringSetup({
  token,
  onReady,
}: {
  token: string;
  onReady: () => void;
}) {
  const [status, setStatus] = useState<PairStatus>("NONE");
  const [label, setLabel] = useState("Waiting for phone");
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [placementConfirmed, setPlacementConfirmed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [frameFresh, setFrameFresh] = useState(false);
  const [recordingLabel, setRecordingLabel] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<string | null>(null);
  const [recordingHasGap, setRecordingHasGap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localhostWarn, setLocalhostWarn] = useState(false);
  const [httpsTrustHint, setHttpsTrustHint] = useState(false);
  const [diag, setDiag] = useState<StatusPayload["diagnostics"] | null>(null);
  const [framing, setFraming] = useState<StatusPayload["framing"]>(null);

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
    setFrameFresh(Boolean(data.frameFresh));
    setRecordingLabel(data.recordingLabel ?? null);
    setRecordingStatus(data.recordingStatus ?? null);
    setRecordingHasGap(Boolean(data.recordingHasGap));
    setDiag(data.diagnostics ?? null);
    setFraming(data.framing ?? null);
    if (data.pairUrl) {
      setLocalhostWarn(
        data.reachableFromPhone === false ||
          ((data.pairUrl.includes("localhost") ||
            data.pairUrl.includes("127.0.0.1")) &&
            !data.pairUrl.startsWith("https://")),
      );
      setHttpsTrustHint(
        Boolean(data.requiresHttpsTrust) || data.pairUrl.startsWith("https://"),
      );
      const qr = await QRCode.toDataURL(data.pairUrl, {
        margin: 1,
        width: 240,
        color: { dark: "#0B0F17", light: "#ffffff" },
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
    const url =
      typeof data.pairUrl === "string" && data.pairUrl.length > 0
        ? data.pairUrl
        : `${window.location.origin}/interview/secondary/${data.pairToken}`;
    setPairUrl(url);
    setStatus(data.status);
    setLabel(data.label ?? "Waiting for phone");
    setPlacementConfirmed(false);
    setLocalhostWarn(
      data.reachableFromPhone === false ||
        ((url.includes("localhost") || url.includes("127.0.0.1")) &&
          !url.startsWith("https://")),
    );
    setHttpsTrustHint(
      Boolean(data.requiresHttpsTrust) || url.startsWith("https://"),
    );
    const qr = await QRCode.toDataURL(url, {
      margin: 1,
      width: 240,
      color: { dark: "#0B0F17", light: "#ffffff" },
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
      setError(data.error ?? "Could not confirm placement");
      return;
    }
    setPlacementConfirmed(true);
  }

  async function resetPlacement() {
    setBusy(true);
    await fetch(`/api/interview/${token}/proctoring/secondary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_placement" }),
    });
    setBusy(false);
    setPlacementConfirmed(false);
    await refreshStatus();
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

  const extraPersonBlocking = Boolean(framing?.extraPersonInPrimaryZone);
  const placementReady =
    status === "CONNECTED" && frameFresh && Boolean(previewUrl) && !extraPersonBlocking;

  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-2xl border border-border bg-card p-8 shadow-sm">
      <div>
        <BrandLogo size="header" />
        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
          Enhanced proctoring
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
          Pair secondary camera
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Position your phone so the candidate, interview computer, keyboard/desk,
          and a substantial part of the surrounding workspace are visible. Leave
          it still. Quiet room, only the candidate in frame. Look only at the
          laptop camera — looking at this phone ends the interview. Video and
          room audio are recorded for human review only (not AI scoring).
        </p>
      </div>

      <div className={cn("rounded-lg border px-3 py-2 text-sm font-medium", statusTone(status))}>
        <div className="flex items-center justify-between gap-2">
          <span>Secondary Camera</span>
          {status === "CONNECTED" ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-ai">
              ● Live
            </span>
          ) : status === "STALE" || status === "RECONNECTING" ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-warning">
              Connection interrupted
            </span>
          ) : null}
        </div>
        <p className="mt-1 font-normal">{label}</p>
        {recordingLabel ? (
          <p className={cn("mt-1 text-xs font-normal", recordingTone(recordingStatus ?? undefined))}>
            {recordingLabel}
            {recordingHasGap ? " · Recording contains an interruption." : ""}
          </p>
        ) : null}
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
        <div className="space-y-2 rounded-xl border border-border p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="QR code to open secondary camera"
            className="mx-auto h-48 w-48"
          />
          <p className="break-all text-center text-xs text-muted-foreground">
            {pairUrl}
          </p>
          {localhostWarn ? (
            <p className="text-xs text-warning">
              Could not build a phone-reachable URL. Run{" "}
              <code className="text-foreground">npm run db:ensure</code> then{" "}
              <code className="text-foreground">npm run https:up</code>, and
              refresh the QR code.
            </p>
          ) : httpsTrustHint ? (
            <p className="text-xs text-muted-foreground">
              Phone and this PC must be on the <strong>same Wi‑Fi</strong> —
              turn off mobile data. Scan a <strong>fresh QR</strong> (do not
              reopen an old 192.168… tab). Brave will warn about the local
              certificate: tap Advanced → Proceed, then Allow camera &amp;
              microphone.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Phone must be on the same Wi‑Fi as this PC. Scan the QR or open
              the URL above.
            </p>
          )}
        </div>
      ) : null}

      {status === "CONNECTED" ||
      status === "STALE" ||
      status === "RECONNECTING" ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">
            {placementConfirmed
              ? "Camera placement ready"
              : "Checking camera placement"}
          </p>
          <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Secondary camera live preview"
                className="max-h-[50vh] w-full bg-background object-contain"
              />
            ) : (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {status === "STALE"
                  ? "Connection interrupted — waiting for frames…"
                  : "Connecting camera — waiting for first preview frame…"}
              </p>
            )}
            {previewUrl && !placementConfirmed ? <PlacementGuideOverlay /> : null}
          </div>

          {status === "CONNECTED" ? (
            <ul className="space-y-1 text-sm text-foreground">
              <li>
                {framing?.candidateVisible
                  ? "✓ Candidate visible"
                  : "○ Candidate visible"}
              </li>
              <li>
                {framing?.laptopVisible ? "✓ Laptop visible" : "○ Laptop visible"}
              </li>
              <li>✓ Surrounding interview area visible</li>
              <li>
                {extraPersonBlocking
                  ? "⚠ Additional person detected"
                  : "✓ No additional person detected"}
              </li>
            </ul>
          ) : null}

          {!placementConfirmed ? (
            <>
              <p className="text-sm text-foreground/90">
                {extraPersonBlocking
                  ? "Please make sure only the candidate is in the interview area before continuing."
                  : placementReady
                  ? "Confirm that the candidate’s upper body, laptop, and surrounding area are visible. Reposition the phone if framing is insufficient."
                  : "Wait for a stable live preview, then leave the phone still so framing matches the guide."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={confirmPlacement}
                  disabled={busy || !placementReady}
                >
                  Confirm Placement
                </Button>
                <Button
                  variant="outline"
                  onClick={resetPlacement}
                  disabled={busy}
                >
                  Recheck camera
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-success">
                Placement confirmed — recording will start when the interview
                begins.
              </p>
              <Button variant="outline" size="sm" onClick={resetPlacement}>
                Reposition Phone
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {showDiag && diag ? (
        <pre className="overflow-auto rounded-lg bg-primary/15 p-3 text-[10px] text-foreground">
          {JSON.stringify(diag, null, 2)}
        </pre>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button
        className="w-full"
        disabled={!placementConfirmed || status !== "CONNECTED" || extraPersonBlocking}
        onClick={onReady}
      >
        Continue to interview
      </Button>
    </div>
  );
}
