"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Pre-interview Strict integrity notice.
 * Does NOT claim OS apps / AnyDesk / extensions will be detected.
 */
export function IntegrityNotice({
  onContinue,
}: {
  onContinue: () => void | Promise<void>;
}) {
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!acked) return;
    setBusy(true);
    setError(null);
    try {
      await onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Logisoft HireOS
      </p>
      <p className="text-sm uppercase tracking-wide text-muted-foreground">
        Interview integrity
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Interview Integrity Requirements
      </h1>
      <p className="text-sm leading-relaxed text-foreground/90">
        During this interview:
      </p>
      <ul className="list-disc space-y-2 pl-5 text-sm text-foreground/90">
        <li>Keep this interview window active.</li>
        <li>Do not switch tabs or windows.</li>
        <li>Do not open other websites or applications.</li>
        <li>Do not copy/paste external content.</li>
        <li>Do not exit fullscreen when fullscreen is required.</li>
        <li>Do not use unauthorized assistance.</li>
      </ul>
      <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Switching away from the interview window may be detected. Violations may
        end the interview automatically. This uses browser focus and visibility
        signals — not operating-system process scanning.
      </p>

      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-1"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
        />
        <span>I understand and agree.</span>
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button className="w-full" disabled={!acked || busy} onClick={submit}>
        {busy ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
