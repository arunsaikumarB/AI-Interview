"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type JobOption = { id: string; title: string; status: string; location?: string | null };

export function AddToJob({ candidateId, jobs }: { candidateId: string; jobs: JobOption[] }) {
  const router = useRouter();
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = (await res.json().catch(() => null)) as { applicationId?: string; error?: string } | null;
      if (!res.ok || !data?.applicationId) {
        setError(data?.error ?? "Could not add to hiring. Try again.");
        return;
      }
      setJobId("");
      router.push(`/dashboard/candidates/${candidateId}?applicationId=${data.applicationId}`);
      router.refresh();
    } catch {
      setError("Could not reach HireOS. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (jobs.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No open job openings to add this candidate to.</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-8 min-w-[220px] rounded-lg border border-input bg-background px-2 text-sm text-foreground"
          value={jobId}
          disabled={busy}
          onChange={(e) => setJobId(e.target.value)}
          aria-label="Select job opening"
        >
          <option value="">Select job opening…</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
              {j.location ? ` — ${j.location}` : ""}
              {j.status !== "OPEN" ? ` (${j.status.toLowerCase()})` : ""}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" onClick={() => void add()} disabled={!jobId || busy}>
          {busy ? "Adding…" : "Add to Hiring"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
