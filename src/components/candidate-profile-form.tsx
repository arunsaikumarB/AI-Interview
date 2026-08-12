"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export function CandidateProfileForm({
  initial,
}: {
  initial: {
    phone: string;
    linkedIn: string;
    location: string;
    summary: string;
    skills: string;
  };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const skills = String(form.get("skills") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await fetch("/api/candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: String(form.get("phone") || "") || null,
        linkedIn: String(form.get("linkedIn") || "") || null,
        location: String(form.get("location") || "") || null,
        summary: String(form.get("summary") || "") || null,
        skills,
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

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
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
        <Label htmlFor="linkedIn">LinkedIn / portfolio</Label>
        <Input id="linkedIn" name="linkedIn" defaultValue={initial.linkedIn} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="skills">Skills (comma-separated)</Label>
        <Input id="skills" name="skills" defaultValue={initial.skills} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="summary">Summary</Label>
        <Textarea id="summary" name="summary" rows={4} defaultValue={initial.summary} />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
