"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { INTERVIEW_TYPES, type InterviewTypeOption } from "@/lib/constants";

export function CreateInterviewDialog({
  applicationId,
  triggerLabel = "Create Interview Link",
}: {
  applicationId: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [interviewType, setInterviewType] = useState<InterviewTypeOption>("TECHNICAL");
  const [maxQuestions, setMaxQuestions] = useState(12);
  const [mode, setMode] = useState<"TEXT" | "VOICE">("TEXT");
  const [proctoringEnabled, setProctoringEnabled] = useState(false);

  async function create() {
    setLoading(true);
    const res = await fetch(`/api/applications/${applicationId}/interviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interviewType,
        maxQuestions,
        mode,
        proctoringEnabled,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "Could not create interview");
      return;
    }
    toast.success("Plan generated — review before sharing the link");
    setOpen(false);
    router.push(`/dashboard/interviews/${data.interview.id}/plan`);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <p className="text-sm font-medium text-slate-900">New AI interview</p>
      <p className="text-xs text-amber-700">
        AI suggestion only — does not change pipeline stage. You&apos;ll review
        the plan before sharing the candidate link.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="mode">Mode</Label>
          <select
            id="mode"
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as "TEXT" | "VOICE")}
          >
            <option value="TEXT">TEXT</option>
            <option value="VOICE">VOICE</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={interviewType}
            onChange={(e) =>
              setInterviewType(e.target.value as InterviewTypeOption)
            }
          >
            {INTERVIEW_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="max">Max questions</Label>
          <Input
            id="max"
            type="number"
            min={3}
            max={30}
            value={maxQuestions}
            onChange={(e) => setMaxQuestions(Number(e.target.value) || 12)}
          />
        </div>
      </div>
      {mode === "VOICE" ? (
        <p className="text-xs text-slate-500">
          Requires local speech-service on port 8001. Candidates can fall back to typing.
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={proctoringEnabled}
          onChange={(e) => setProctoringEnabled(e.target.checked)}
        />
        <span>
          Enable proctoring signals (tab focus, paste, optional camera face
          presence — human review only; default off)
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={create} disabled={loading}>
          {loading ? "Generating plan… (10–40s)" : "Create & generate plan"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
