"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function PortalProfileForm({
  initial,
}: {
  initial: {
    phone: string;
    location: string;
    summary: string;
    hasResume: boolean;
    resumeTextLength: number;
  };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/portal/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: String(form.get("phone") || "") || null,
        location: String(form.get("location") || "") || null,
        summary: String(form.get("summary") || "") || null,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "Save failed");
      return;
    }
    toast.success("Profile saved");
    router.refresh();
  }

  async function onResume(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploading(true);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/portal/profile", {
      method: "PUT",
      body: form,
    });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) {
      toast.error(data.error ?? "Upload failed");
      return;
    }
    toast.success(
      data.parsed
        ? "Resume uploaded and parsed"
        : `Uploaded${data.parseError ? ` (parse: ${data.parseError})` : ""}`,
    );
    router.refresh();
  }

  return (
    <div className="max-w-xl space-y-10">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={initial.phone} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" defaultValue={initial.location} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="summary">Summary</Label>
          <Textarea
            id="summary"
            name="summary"
            rows={4}
            defaultValue={initial.summary}
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save profile"}
        </Button>
      </form>

      <form onSubmit={onResume} className="space-y-4 border-t border-slate-200 pt-8">
        <div>
          <h2 className="text-lg font-medium text-slate-900">Resume</h2>
          <p className="mt-1 text-sm text-slate-500">
            {initial.hasResume
              ? `On file${initial.resumeTextLength ? ` · ${initial.resumeTextLength} chars extracted` : ""}`
              : "No resume uploaded yet"}
            . PDF, DOCX, or TXT · max 10MB.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="resume">Upload new resume</Label>
          <Input
            id="resume"
            name="resume"
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,text/plain"
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={uploading}>
          {uploading ? "Uploading…" : "Re-upload resume"}
        </Button>
      </form>
    </div>
  );
}
