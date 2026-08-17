"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { isAcceptedEnqueue } from "@/lib/staff-async/flag";
import { staffAsyncLabel } from "@/lib/staff-async/label";
import { useStaffAsyncPoll } from "@/lib/staff-async/use-staff-async-poll";

export function ResumeUpload({
  applicationId,
  onUploaded,
}: {
  applicationId?: string;
  onUploaded?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [poll, setPoll] = useState(false);

  const status = useStaffAsyncPoll({
    url: candidateId
      ? `/api/documents/process-status?candidateId=${candidateId}`
      : null,
    enabled: poll && Boolean(candidateId),
    onComplete: () => {
      setPoll(false);
      setLoading(false);
      toast.success("Resume processed");
      onUploaded?.();
    },
    onFailed: (message) => {
      setPoll(false);
      setLoading(false);
      toast.error(message);
    },
  });

  async function onChange(file: File | null) {
    if (!file) return;
    setLoading(true);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", "RESUME");
    if (applicationId) form.set("applicationId", applicationId);

    const res = await fetch("/api/documents/upload", { method: "POST", body: form });
    const data = await res.json();

    if (!res.ok) {
      setLoading(false);
      toast.error(data.error ?? "Upload failed");
      return;
    }

    if (isAcceptedEnqueue(String(data.status ?? "")) && data.candidate?.id) {
      setCandidateId(data.candidate.id);
      setPoll(true);
      toast.message("Resume uploaded — processing queued");
      return;
    }

    setLoading(false);
    if (data.parsed) {
      toast.success("Resume uploaded and parsed locally");
    } else {
      toast.warning(data.parseError ?? "Uploaded, but text could not be extracted");
    }
    onUploaded?.();
  }

  return (
    <div className="flex items-center gap-3">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/40">
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf"
          className="hidden"
          disabled={loading}
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
        {loading
          ? poll
            ? staffAsyncLabel(status.status ?? "QUEUED")
            : "Uploading…"
          : "Upload resume"}
      </label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        className="pointer-events-none text-xs text-muted-foreground"
      >
        PDF / DOCX / TXT · local parse
      </Button>
    </div>
  );
}
