"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ComposeEmailDialog } from "@/components/compose-email-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_LINK_EXPIRE_DAYS,
  DURATION_OPTIONS,
  LINK_EXPIRE_OPTIONS,
  candidateInterviewUrl,
} from "@/lib/interview-links";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";

export type CreateInterviewApplicationOption = {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobId: string;
  jobTitle: string;
};

type CreatedLink = {
  interviewId: string;
  accessToken: string;
  candidateName: string;
  jobTitle: string;
  candidateId: string;
  applicationId: string;
  tokenExpiresAt: string | null;
};

export function CreateInterviewDialog({
  applications,
  triggerLabel = "Create Interview",
  /** When set, open immediately (e.g. from Candidate Detail / query). */
  defaultOpen = false,
  preselectedApplicationId,
  preselectedCandidateId,
  preselectedJobId,
  showTrigger = true,
}: {
  applications: CreateInterviewApplicationOption[];
  triggerLabel?: string;
  defaultOpen?: boolean;
  preselectedApplicationId?: string;
  preselectedCandidateId?: string;
  preselectedJobId?: string;
  showTrigger?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(false);
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [applicationId, setApplicationId] = useState(preselectedApplicationId ?? "");
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES);
  const [linkExpiresInDays, setLinkExpiresInDays] = useState(DEFAULT_LINK_EXPIRE_DAYS);
  const [proctoringMode, setProctoringMode] = useState<
    "OFF" | "STANDARD" | "ENHANCED"
  >("STANDARD");
  const [integrityMode, setIntegrityMode] = useState<"STANDARD" | "STRICT">(
    "STANDARD",
  );
  const [mode, setMode] = useState<"TEXT" | "VOICE">("TEXT");
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  useEffect(() => {
    if (!loading) {
      setLoadingElapsedSec(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => {
      setLoadingElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  useEffect(() => {
    if (preselectedApplicationId) {
      setApplicationId(preselectedApplicationId);
      return;
    }
    if (preselectedCandidateId || preselectedJobId) {
      const match = applications.find((a) => {
        if (preselectedCandidateId && a.candidateId !== preselectedCandidateId) {
          return false;
        }
        if (preselectedJobId && a.jobId !== preselectedJobId) return false;
        return true;
      });
      if (match) setApplicationId(match.id);
    }
  }, [
    preselectedApplicationId,
    preselectedCandidateId,
    preselectedJobId,
    applications,
  ]);

  const filteredApps = useMemo(() => {
    const q = candidateQuery.trim().toLowerCase();
    let list = applications;
    if (preselectedCandidateId) {
      list = list.filter((a) => a.candidateId === preselectedCandidateId);
    }
    if (preselectedJobId && !preselectedApplicationId) {
      list = list.filter((a) => a.jobId === preselectedJobId);
    }
    if (!q) return list;
    return list.filter(
      (a) =>
        a.candidateName.toLowerCase().includes(q) ||
        a.candidateEmail.toLowerCase().includes(q) ||
        a.jobTitle.toLowerCase().includes(q),
    );
  }, [
    applications,
    candidateQuery,
    preselectedCandidateId,
    preselectedJobId,
    preselectedApplicationId,
  ]);

  const selected = applications.find((a) => a.id === applicationId) ?? null;

  const candidateChoices = useMemo(() => {
    const map = new Map<string, { id: string; name: string; email: string }>();
    for (const a of filteredApps) {
      if (!map.has(a.candidateId)) {
        map.set(a.candidateId, {
          id: a.candidateId,
          name: a.candidateName,
          email: a.candidateEmail,
        });
      }
    }
    return Array.from(map.values());
  }, [filteredApps]);

  const jobsForCandidate = useMemo(() => {
    if (!selected && !preselectedCandidateId) {
      const firstCand = candidateChoices[0]?.id;
      if (!firstCand) return [];
      return filteredApps.filter((a) => a.candidateId === firstCand);
    }
    const candId = selected?.candidateId ?? preselectedCandidateId;
    if (!candId) return [];
    return filteredApps.filter((a) => a.candidateId === candId);
  }, [filteredApps, selected, preselectedCandidateId, candidateChoices]);

  function resetForm() {
    setCreated(null);
    setLoading(false);
    setCandidateQuery("");
    setDurationMinutes(DEFAULT_DURATION_MINUTES);
    setLinkExpiresInDays(DEFAULT_LINK_EXPIRE_DAYS);
    setProctoringMode("STANDARD");
    setIntegrityMode("STANDARD");
    setMode("TEXT");
    if (!preselectedApplicationId) setApplicationId("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      resetForm();
      router.refresh();
    }
  }

  async function create() {
    if (!applicationId) {
      toast.error("Select a candidate and job");
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240_000);
    try {
      const res = await fetch(`/api/applications/${applicationId}/interviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          interviewType: "TECHNICAL",
          maxQuestions: 12,
          mode,
          proctoringEnabled: proctoringMode !== "OFF",
          proctoringMode,
          integrityMode,
          linkExpiresInDays,
          durationMinutes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not create interview");
        return;
      }
      const app = applications.find((a) => a.id === applicationId)!;
      setCreated({
        interviewId: data.interview.id,
        accessToken: data.interview.accessToken,
        candidateName: app.candidateName,
        jobTitle: app.jobTitle,
        candidateId: app.candidateId,
        applicationId: app.id,
        tokenExpiresAt: data.interview.tokenExpiresAt ?? null,
      });
      toast.success("Interview link created");
      router.refresh();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        toast.error(
          "Plan generation timed out. Ollama is slow on CPU — wait and retry, or keep the tab open longer next time.",
        );
      } else {
        toast.error("Could not create interview");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    await navigator.clipboard.writeText(
      candidateInterviewUrl(created.accessToken, window.location.origin),
    );
    toast.success("Link copied.");
  }

  return (
    <>
      {showTrigger ? (
        <Button onClick={() => setOpen(true)}>{triggerLabel}</Button>
      ) : null}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {!created ? (
            <>
              <DialogHeader>
                <DialogTitle>Create Interview</DialogTitle>
                <DialogDescription>
                  Create an interview link to invite a candidate to an AI interview.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cand-search">Candidate</Label>
                  {!preselectedApplicationId && !preselectedCandidateId ? (
                    <Input
                      id="cand-search"
                      placeholder="Search by name or email…"
                      value={candidateQuery}
                      onChange={(e) => setCandidateQuery(e.target.value)}
                    />
                  ) : null}
                  <select
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    value={selected?.candidateId ?? ""}
                    disabled={Boolean(preselectedCandidateId || preselectedApplicationId)}
                    onChange={(e) => {
                      const candId = e.target.value;
                      const first = filteredApps.find((a) => a.candidateId === candId);
                      setApplicationId(first?.id ?? "");
                    }}
                  >
                    <option value="">Select candidate…</option>
                    {candidateChoices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="job">Job</Label>
                  <select
                    id="job"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    value={applicationId}
                    disabled={
                      Boolean(preselectedApplicationId) ||
                      (!selected && !preselectedCandidateId)
                    }
                    onChange={(e) => setApplicationId(e.target.value)}
                  >
                    <option value="">Select job…</option>
                    {jobsForCandidate.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.jobTitle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Interview type</Label>
                  <Input value="AI Interview" disabled readOnly />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="duration">Duration</Label>
                    <select
                      id="duration"
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    >
                      {DURATION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expires">Link expiration</Label>
                    <select
                      id="expires"
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      value={linkExpiresInDays}
                      onChange={(e) => setLinkExpiresInDays(Number(e.target.value))}
                    >
                      {LINK_EXPIRE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mode">Mode</Label>
                  <select
                    id="mode"
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "TEXT" | "VOICE")}
                  >
                    <option value="TEXT">Text</option>
                    <option value="VOICE">Voice</option>
                  </select>
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-foreground">
                    Interview Integrity
                  </legend>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="integrity"
                      className="mt-1"
                      checked={integrityMode === "STANDARD"}
                      onChange={() => setIntegrityMode("STANDARD")}
                    />
                    <span>
                      <span className="font-medium text-foreground">Standard</span>
                      <span className="block text-xs text-muted-foreground">
                        Browser integrity signals are recorded.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="integrity"
                      className="mt-1"
                      checked={integrityMode === "STRICT"}
                      onChange={() => {
                        setIntegrityMode("STRICT");
                        if (proctoringMode === "OFF") setProctoringMode("STANDARD");
                      }}
                    />
                    <span>
                      <span className="font-medium text-foreground">Strict</span>
                      <span className="block text-xs text-muted-foreground">
                        Repeated integrity violations may end the interview.
                      </span>
                    </span>
                  </label>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-foreground">Proctoring</legend>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="proctoring"
                      className="mt-1"
                      checked={proctoringMode === "STANDARD"}
                      onChange={() => setProctoringMode("STANDARD")}
                    />
                    <span>
                      <span className="font-medium text-foreground">Standard</span>
                      <span className="block text-xs text-muted-foreground">
                        Browser signals only
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="proctoring"
                      className="mt-1"
                      checked={proctoringMode === "ENHANCED"}
                      onChange={() => setProctoringMode("ENHANCED")}
                    />
                    <span>
                      <span className="font-medium text-foreground">Enhanced</span>
                      <span className="block text-xs text-muted-foreground">
                        Browser signals + secondary camera pairing (human review)
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground/90">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={proctoringMode === "OFF"}
                      onChange={(e) =>
                        setProctoringMode(e.target.checked ? "OFF" : "STANDARD")
                      }
                    />
                    <span>Disable proctoring for this interview</span>
                  </label>
                </fieldset>

                {applications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active applications yet. Add a candidate to a job first.
                  </p>
                ) : null}

                {loading ? (
                  <p className="w-full text-sm text-muted-foreground sm:order-first sm:mr-auto">
                    Generating AI interview plan with local Ollama… {loadingElapsedSec}s
                    <span className="mt-1 block text-xs text-muted-foreground">
                      On CPU this often takes 1–3 minutes. Keep this dialog open.
                    </span>
                  </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => handleOpenChange(false)}
                    disabled={loading}
                  >
                    Cancel
                  </Button>
                  <Button onClick={create} disabled={loading || !applicationId}>
                    {loading
                      ? loadingElapsedSec < 5
                        ? "Creating…"
                        : `Generating plan… ${loadingElapsedSec}s`
                      : "Create Interview Link"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Interview link created</DialogTitle>
                <DialogDescription>
                  Share the link with the candidate when you are ready.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 pt-2 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Candidate
                  </p>
                  <p className="font-medium text-foreground">{created.candidateName}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Job</p>
                  <p className="font-medium text-foreground">{created.jobTitle}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                  <p className="font-medium text-foreground">Active</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Expires</p>
                  <p className="font-medium text-foreground">
                    {created.tokenExpiresAt
                      ? formatDate(created.tokenExpiresAt)
                      : "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button onClick={copyLink}>Copy Link</Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      window.open(
                        candidateInterviewUrl(
                          created.accessToken,
                          window.location.origin,
                        ),
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    Open Interview
                  </Button>
                  <Button variant="outline" onClick={() => setEmailOpen(true)}>
                    Send Email
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  You can review the AI plan anytime from the Interview Links table.
                </p>
                <div className="flex justify-end">
                  <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                    Done
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {created ? (
        <ComposeEmailDialog
          candidateId={created.candidateId}
          applicationId={created.applicationId}
          category="interview_invite"
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
        />
      ) : null}
    </>
  );
}
