"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const APPLY_TIMEOUT_MS = 120_000;

export function CareersApplyForm({
  jobId,
  jobTitle,
}: {
  jobId: string;
  jobTitle: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createAccount, setCreateAccount] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("jobId", jobId);
    if (!createAccount) {
      data.delete("password");
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), APPLY_TIMEOUT_MS);

    try {
      const res = await fetch("/api/careers/apply", {
        method: "POST",
        body: data,
        signal: controller.signal,
      });

      let json: {
        error?: string;
        alreadyApplied?: boolean;
        applicationId?: string;
        accountCreated?: boolean;
        dropped?: boolean;
      } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        setError("Server returned an invalid response. Please try again.");
        return;
      }

      if (res.status === 409 && json.alreadyApplied) {
        router.push(`/careers/${jobId}/apply?already=1`);
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Application failed");
        return;
      }
      if (json.dropped) {
        router.push(`/careers/${jobId}/apply?done=1`);
        return;
      }
      router.push(
        `/careers/${jobId}/apply?done=1${json.accountCreated ? "&account=1" : ""}`,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Submission timed out. Please try again with a smaller PDF, or use DOCX/TXT.");
      } else {
        setError("Network error. Check your connection and try again.");
      }
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" encType="multipart/form-data">
      {/* Honeypot — leave empty */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
        <Label htmlFor="website">Website</Label>
        <Input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input id="phone" name="phone" type="tel" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="location">Location (optional)</Label>
          <Input id="location" name="location" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="resume">Resume (PDF, DOCX, or TXT · max 10MB)</Label>
        <Input
          id="resume"
          name="resume"
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,text/plain"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="coverNote">Cover note (optional)</Label>
        <Textarea id="coverNote" name="coverNote" rows={4} />
      </div>

      <label className="flex items-start gap-2 text-sm text-foreground/90">
        <input
          type="checkbox"
          className="mt-1"
          checked={createAccount}
          onChange={(e) => setCreateAccount(e.target.checked)}
        />
        <span>
          Create a candidate portal account so I can track this application for{" "}
          <strong className="font-medium">{jobTitle}</strong>
        </span>
      </label>

      {createAccount ? (
        <div className="space-y-2">
          <Label htmlFor="password">Password (min 10 characters)</Label>
          <Input
            id="password"
            name="password"
            type="password"
            minLength={10}
            required={createAccount}
            autoComplete="new-password"
          />
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={loading} className="w-full sm:w-auto">
        {loading ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
