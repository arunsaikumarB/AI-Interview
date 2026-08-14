"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";

const CONSENT_COPY_STANDARD =
  "This interview monitors tab focus, window switching, copy/paste, and (if you allow the camera) whether a face is visible. These are informational signals reviewed by a human recruiter; they do not automatically affect your result.";

const CONSENT_COPY_ENHANCED =
  "Enhanced proctoring uses a secondary device camera and microphone. Keep the phone still in a quiet room with only you in frame. Look only at the interview laptop camera, not the secondary phone. The interview session will end if: the secondary camera is moved twice; you leave the secondary frame; another person appears in that frame; or you look at the secondary camera.";

export function ProctoringConsent({
  onContinue,
  enhanced = false,
}: {
  onContinue: (
    cameraConsent: boolean,
    recordingConsent: boolean,
  ) => void | Promise<void>;
  enhanced?: boolean;
}) {
  const [acked, setAcked] = useState(false);
  const [cameraConsent, setCameraConsent] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!acked) return;
    if (enhanced && !recordingConsent) return;
    setBusy(true);
    setError(null);
    try {
      await onContinue(cameraConsent, enhanced ? recordingConsent : false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save consent");
      setBusy(false);
    }
  }

  const canContinue = acked && (!enhanced || recordingConsent);

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
      <BrandLogo size="header" />
      <p className="text-sm uppercase tracking-wide text-muted-foreground">
        Proctoring consent
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Proctoring notice</h1>
      <p className="text-sm leading-relaxed text-foreground/90">
        {enhanced ? CONSENT_COPY_ENHANCED : CONSENT_COPY_STANDARD}
      </p>

      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-1"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        <span>
          {enhanced
            ? "I understand the recording is for human review (not AI scoring), and that the interview session may end if environment rules are broken."
            : "I understand these signals are for human review only."}
        </span>
      </label>

      {enhanced ? (
        <div className="space-y-2 rounded-xl border border-border px-3 py-3">
          <p className="text-sm font-medium text-foreground">
            Secondary camera recording
          </p>
          <p className="text-sm text-foreground/90">
            The secondary device camera and microphone will be recorded during
            the interview for recruiter review.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>What: secondary camera video and room audio</li>
            <li>Why: so a recruiter can review the interview environment</li>
            <li>Who: hiring-team recruiters in this organization only</li>
            <li>
              Retention: stored on this company&apos;s self-hosted system and
              deleted according to the organization&apos;s local retention
              policy
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Recording does not start until you confirm. It is not used for AI
            scoring or automatic hiring decisions.
          </p>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-1"
              checked={recordingConsent}
              onChange={(e) => setRecordingConsent(e.target.checked)}
            />
            <span>
              I understand and consent to secondary camera recording (video and
              microphone).
            </span>
          </label>
        </div>
      ) : null}

      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-1"
          checked={cameraConsent}
          onChange={(e) => setCameraConsent(e.target.checked)}
        />
        <span>
          Allow primary laptop camera for face-presence signals (optional). You
          can decline and still continue — tab focus and paste monitoring still
          apply.
        </span>
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button className="w-full" disabled={!canContinue || busy} onClick={submit}>
        {busy ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
