"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";

export function IntegrityWarningDialog({
  open,
  warningNumber,
  warningOf,
  message,
  onDismiss,
  stayHint = "Please remain on the interview screen for the rest of the interview.",
}: {
  open: boolean;
  warningNumber: number;
  warningOf: number;
  /** Neutral candidate message — never technical event names. */
  message: string;
  onDismiss: () => void;
  stayHint?: string;
}) {
  if (!open) return null;

  // Warning N of 3 (secondary) or N of 2 (Strict). Dialog stays until they confirm.
  const of = Math.max(warningOf, 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="integrity-warning-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2
          id="integrity-warning-title"
          className="text-2xl font-semibold tracking-tight text-foreground"
        >
          Interview Integrity Warning
        </h2>
        <p className="text-sm leading-relaxed text-foreground/90">{message}</p>
        <p className="text-sm text-muted-foreground">{stayHint}</p>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Warning {warningNumber} of {of}
        </p>
        <Button className="h-11 w-full" onClick={onDismiss}>
          I understand — I&apos;ve fixed this
        </Button>
      </div>
    </div>
  );
}

export function IntegrityTerminatedScreen({
  onClose,
}: {
  onClose?: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-2xl border border-border bg-card p-8 shadow-sm">
      <BrandLogo size="header" />
      <p className="text-sm uppercase tracking-wide text-muted-foreground">
        Interview ended
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Interview Ended</h1>
      <p className="text-sm leading-relaxed text-foreground/90">
        The interview was ended because the interview environment requirements
        were not met.
      </p>
      <p className="text-sm text-muted-foreground">
        Please contact the recruiter if you believe this happened in error.
      </p>
      <Button
        className="w-full"
        variant="outline"
        onClick={() => {
          if (onClose) onClose();
          else window.close();
        }}
      >
        Close Interview
      </Button>
    </div>
  );
}

export function FullscreenRequiredGate({
  onEntered,
}: {
  onEntered: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    setError(null);
    try {
      await document.documentElement.requestFullscreen();
      onEntered();
    } catch {
      setError(
        "Could not enter fullscreen. Allow fullscreen for this site and try again.",
      );
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Fullscreen is required for this interview.
      </h1>
      <p className="text-sm text-muted-foreground">
        Stay in fullscreen for the duration of the interview. Exiting may count
        as an integrity warning.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" onClick={enter}>
        Enter Fullscreen
      </Button>
    </div>
  );
}
