"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function ResumeUpload({
  applicationId,
  onUploaded,
}: {
  applicationId?: string;
  onUploaded?: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function onChange(file: File | null) {
    if (!file) return;
    setLoading(true);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", "RESUME");
    if (applicationId) form.set("applicationId", applicationId);

    const res = await fetch("/api/documents/upload", { method: "POST", body: form });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error ?? "Upload failed");
      return;
    }

    if (data.parsed) {
      toast.success("Resume uploaded and parsed locally");
    } else {
      toast.warning(data.parseError ?? "Uploaded, but text could not be extracted");
    }
    onUploaded?.();
  }

  return (
    <div className="flex items-center gap-3">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf"
          className="hidden"
          disabled={loading}
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
        {loading ? "Uploading…" : "Upload resume"}
      </label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        className="pointer-events-none text-xs text-slate-400"
      >
        PDF / DOCX / TXT · local parse
      </Button>
    </div>
  );
}
