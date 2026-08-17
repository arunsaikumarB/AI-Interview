"use client";

import { useEffect, useState } from "react";
import { staffAsyncLabel } from "@/lib/staff-async/label";
import { useStaffAsyncPoll } from "@/lib/staff-async/use-staff-async-poll";
import { isAcceptedEnqueue } from "@/lib/staff-async/flag";

/** Client-safe accepted check from JSON status. */
function accepted(status: string | undefined): boolean {
  return isAcceptedEnqueue(status ?? "");
}

export function StaffProctoringProcess({ sessionId }: { sessionId: string }) {
  const [job, setJob] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/interviews/${sessionId}/proctoring-process`, {
        method: "POST",
      });
      const data = (await res.json()) as { status?: string; error?: string };
      if (cancelled) return;
      if (!res.ok || !accepted(data.status)) {
        setFailed(data.error ?? "Could not queue proctoring processing");
        return;
      }
      setJob("queued");
      setMessage("Post-session processing queued");
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const poll = useStaffAsyncPoll({
    url: `/api/interviews/${sessionId}/proctoring-process`,
    enabled: Boolean(job),
    onComplete: () => setMessage("Post-session processing completed"),
    onFailed: (msg) => setFailed(msg),
  });

  if (!job && !failed && !message) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {failed
        ? failed
        : `${staffAsyncLabel(poll.status ?? job)} — ${message ?? "Recording / report"}`}
    </p>
  );
}

export function StaffTtsPrefetch({
  sessionId,
  questionIds,
}: {
  sessionId: string;
  questionIds: string[];
}) {
  const key = questionIds.join(",");
  useEffect(() => {
    if (!key) return;
    const ids = key.split(",").filter(Boolean);
    void (async () => {
      for (const questionId of ids) {
        await fetch(`/api/interviews/${sessionId}/prefetch-tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId }),
        });
      }
    })();
  }, [sessionId, key]);
  return null;
}
