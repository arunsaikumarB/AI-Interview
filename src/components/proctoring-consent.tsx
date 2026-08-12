"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const CONSENT_COPY =
  "This interview monitors tab focus, window switching, copy/paste, and (if you allow the camera) whether a face is visible. These are informational signals reviewed by a human recruiter; they do not automatically affect your result.";

export function ProctoringConsent({
  onContinue,
}: {
  onContinue: (cameraConsent: boolean) => void | Promise<void>;
}) {
  const [acked, setAcked] = useState(false);
  const [cameraConsent, setCameraConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!acked) return;
    setBusy(true);
    setError(null);
    try {
      await onContinue(cameraConsent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save consent");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm uppercase tracking-wide text-slate-400">
        Proctoring consent
      </p>
      <h1 className="font-display text-3xl text-slate-900">Before you begin</h1>
      <p className="text-sm leading-relaxed text-slate-700">{CONSENT_COPY}</p>

      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          className="mt-1"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        <span>I understand these signals are for human review only.</span>
      </label>

      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          className="mt-1"
          checked={cameraConsent}
          onChange={(e) => setCameraConsent(e.target.checked)}
        />
        <span>
          Allow camera for face-presence signals (optional). You can decline and
          still continue — tab focus and paste monitoring still apply.
        </span>
      </label>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Button className="w-full" disabled={!acked || busy} onClick={submit}>
        {busy ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
