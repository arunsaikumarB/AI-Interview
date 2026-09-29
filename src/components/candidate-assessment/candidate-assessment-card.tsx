"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ASSESSMENT_CHANGED_EVENT } from "@/lib/candidate-assessment/events";
import type { CompetencyEvidence, EvidenceItem } from "@/lib/candidate-assessment/evidence";
import type { StaffAssessment, StaffInterviewQuestion, StaffPracticalView } from "@/lib/candidate-assessment/service";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<string, string> = {
  NOT_ASSIGNED: "Not assigned",
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  FAILED: "Did not complete",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

const OVERALL_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  PARTIALLY_COMPLETED: "Partially completed",
};

const GENERATION_LABEL: Record<string, string> = {
  FALLBACK_PENDING_AI: "Deterministic wording (AI wording in preparation)",
  AI_ASSISTED: "AI-assisted wording, validated against the blueprint",
  FALLBACK_ONLY: "Deterministic fallback wording",
};

const MISMATCH_LABEL: Record<string, string> = {
  COLUMN_COUNT: "different number of columns",
  COLUMN_NAMES: "different column names",
  ROW_COUNT: "different number of rows",
  VALUES: "different values",
  ORDER: "correct rows in the wrong order",
};

function badgeClass(state: string): string {
  if (state === "COMPLETED") return "bg-success/10 text-success";
  if (state === "IN_PROGRESS") return "bg-primary/10 text-primary";
  if (state === "NOT_STARTED") return "bg-warning/15 text-warning";
  return "bg-muted text-muted-foreground";
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

/** Objective values exactly as recorded by V3. */
export function practicalResultLine(p: Pick<StaffPracticalView, "type" | "result">): string {
  const r = p.result;
  if (!r) return "No result recorded yet";
  if (r.kind === "INFRASTRUCTURE") return `Not executed (${r.failureReason ?? "infrastructure failure"})`;
  const parts: string[] = [];
  if (p.type === "SQL") {
    if (r.correct !== null) parts.push(r.correct ? "Correct result" : `Result differs${r.mismatch ? ` (${MISMATCH_LABEL[r.mismatch] ?? r.mismatch})` : ""}`);
    if (r.rowCount !== null) parts.push(`${r.rowCount} rows`);
    if (r.rowLimitExceeded) parts.push("row limit exceeded");
  } else {
    if (r.passed !== null && r.total !== null) parts.push(`${r.passed} / ${r.total} tests passed`);
    if (r.compileError) parts.push("compile error");
    if (r.memoryMb !== null) parts.push(`${r.memoryMb} MB`);
  }
  if (r.runtimeMs !== null) parts.push(`${r.runtimeMs} ms`);
  if (r.timedOut) parts.push("timed out");
  return parts.join(" · ") || (r.status ?? "Recorded");
}

function evidenceLabel(item: EvidenceItem, answeredCount?: number): string {
  switch (item.sourceType) {
    case "RESUME":
      return item.result.strength === "STRONG" ? "Evidence found" : "Weak evidence found";
    case "INTERVIEW":
      return answeredCount !== undefined
        ? `${answeredCount} answer${answeredCount === 1 ? "" : "s"} recorded`
        : item.result.answered
          ? "Answer recorded"
          : "Asked, no answer yet";
    default: {
      const r = item.result;
      if (!r.submitted) return STATE_LABEL[r.assessmentStatus] ?? "Not submitted";
      return practicalResultLine({ type: item.sourceType, result: r });
    }
  }
}

const SOURCE_LABEL: Record<string, string> = { RESUME: "Resume", INTERVIEW: "Interview", CODING: "Coding", SQL: "SQL" };

export function CandidateAssessmentCard({ applicationId }: { applicationId: string }) {
  const base = `/api/applications/${encodeURIComponent(applicationId)}`;
  const [data, setData] = useState<StaffAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [oneTime, setOneTime] = useState<{ label: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/assessment`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not load the assessment");
        return;
      }
      setData(body.assessment as StaffAssessment);
    } catch {
      setError("Could not load the assessment");
    }
  }, [base]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(ASSESSMENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ASSESSMENT_CHANGED_EVENT, onChange);
  }, [load]);

  async function post(key: string, url: string, body: unknown, method = "POST") {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "The action could not be completed");
        return null;
      }
      window.dispatchEvent(new Event(ASSESSMENT_CHANGED_EVENT));
      return json as Record<string, unknown>;
    } finally {
      setBusy(null);
    }
  }

  async function createInterview() {
    const json = await post("interview", `${base}/interviews`, { source: "BLUEPRINT" });
    if (json && typeof json.candidateLink === "string") {
      setOneTime({ label: "AI interview link", url: json.candidateLink });
      setCopied(false);
    }
  }

  async function assign(type: "CODING" | "SQL") {
    const json = await post(`assign-${type}`, `${base}/practical-assessments`, { type });
    if (json && typeof json.candidatePath === "string") {
      setOneTime({ label: `${type === "SQL" ? "SQL" : "Coding"} assessment link`, url: `${window.location.origin}${json.candidatePath}` });
      setCopied(false);
    }
  }

  async function issueLink() {
    const json = await post("link", `${base}/assessment/link`, {});
    if (json && typeof json.candidatePath === "string") {
      setOneTime({ label: "Candidate assessment link (all components)", url: `${window.location.origin}${json.candidatePath}` });
      setCopied(false);
    }
  }

  async function revokeLink() {
    await post("revoke", `${base}/assessment/link`, undefined, "DELETE");
  }

  async function copy() {
    if (!oneTime) return;
    try {
      await navigator.clipboard.writeText(oneTime.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!data) {
    return (
      <div className="space-y-2">
        <h2 className="text-[17px] font-semibold text-foreground">Assessment</h2>
        <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>
      </div>
    );
  }

  const cap = data.capabilities;
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold text-foreground">Assessment</h2>
          <p className="text-[13px] text-muted-foreground">
            {data.application.jobTitle} · {data.blueprint.roleLabel} · {data.blueprint.seniority.toLowerCase()} · blueprint{" "}
            {data.blueprint.engineVersion}
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", badgeClass(data.overall))}>
          {OVERALL_LABEL[data.overall]}
        </span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {oneTime ? (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          <p className="text-foreground">{oneTime.label}. It is shown only once — copy it now and send it to the candidate.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-muted/50 px-2 py-1 text-[12px]">{oneTime.url}</code>
            <Button size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Components</h3>
        <ul className="space-y-2">
          {data.components.map((c) => {
            const practicalCap = c.key === "CODING" ? cap.assignCoding : c.key === "SQL" ? cap.assignSql : null;
            const capability = practicalCap ?? cap.createInterview;
            const competency = c.competencies.length > 0 ? c.competencies.join(", ") : (practicalCap?.competency ?? null);
            const required = c.state === "NOT_ASSIGNED" && practicalCap ? practicalCap.requiredWhenAssigned : c.required;
            return (
              <li key={c.key} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {c.label}{" "}
                      <span className="text-[12px] font-normal text-muted-foreground">
                        · {required ? "required" : "optional"}
                      </span>
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      {c.key === "AI_INTERVIEW" && !competency
                        ? "Competencies: the blueprint's interview competencies, set when the interview is created"
                        : `${c.competencies.length > 1 ? "Competencies" : "Competency"}: ${competency ?? (capability.allowed ? "—" : capability.reason ?? "—")}`}
                    </p>
                    {c.key === "AI_INTERVIEW" && data.interview ? (
                      <p className="text-[12px] text-muted-foreground">
                        {data.interview.blueprintLinked
                          ? `Configured from blueprint · ${GENERATION_LABEL[data.interview.generation?.status ?? ""] ?? ""}`
                          : "Standard interview (created before blueprint integration)"}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", badgeClass(c.state))}>
                      {STATE_LABEL[c.state]}
                    </span>
                    {capability.allowed ? (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={busy !== null}
                        onClick={() => (c.key === "AI_INTERVIEW" ? createInterview() : assign(c.key as "CODING" | "SQL"))}
                      >
                        {busy === (c.key === "AI_INTERVIEW" ? "interview" : `assign-${c.key}`)
                          ? "Working…"
                          : c.key === "AI_INTERVIEW"
                            ? "Create from blueprint"
                            : "Assign"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-[12px] text-muted-foreground">
          Recommended practical: {data.blueprint.recommendedPractical.title} ({data.blueprint.recommendedPractical.competency}).{" "}
          {cap.assignCoding.requiredWhenAssigned || cap.assignSql.requiredWhenAssigned
            ? "The matching runtime is required; the other is optional."
            : "It has no sandbox runtime, so coding and SQL are optional."}{" "}
          Blueprint interviews use text delivery, 30 minutes, proctoring off.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Candidate link</h3>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
          <p className="text-muted-foreground">
            {data.hubLink
              ? `${data.hubLink.status === "ACTIVE" ? "Active" : data.hubLink.status === "REVOKED" ? "Revoked" : "Expired"} · issued ${fmt(data.hubLink.issuedAt)} · expires ${fmt(data.hubLink.expiresAt)}`
              : "No assessment link issued yet. One link opens every assigned component."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="xs" disabled={busy !== null} onClick={issueLink}>
              {busy === "link" ? "Issuing…" : data.hubLink ? "Issue new link" : "Issue link"}
            </Button>
            {data.hubLink?.status === "ACTIVE" ? (
              <Button variant="ghost" size="xs" disabled={busy !== null} onClick={revokeLink}>
                Revoke
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Assessment summary</h3>
          <p className="text-sm text-foreground">
            Progress {data.progress.completed} / {data.progress.total} completed
            {data.progress.requiredTotal !== data.progress.total
              ? ` · required ${data.progress.requiredCompleted} / ${data.progress.requiredTotal}`
              : ""}
          </p>
        </div>
        <ul className="space-y-2">
          {data.evidence.map((c) => (
            <CompetencyRow
              key={`${c.competencyId ?? "x"}:${c.competency}`}
              entry={c}
              data={data}
              open={open}
              toggle={toggle}
            />
          ))}
        </ul>
      </div>

      {data.practicals.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Practical results</h3>
          <ul className="space-y-1 text-sm">
            {data.practicals.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-foreground">
                  {p.type === "SQL" ? "SQL" : "Coding"} · {p.title}
                </span>
                <span className="text-muted-foreground">{practicalResultLine(p)}</span>
              </li>
            ))}
          </ul>
          <a href="#practical" className="text-[12px] text-primary underline-offset-2 hover:underline">
            Submitted source and per-test results
          </a>
        </div>
      ) : null}

      <p className="text-[12px] text-muted-foreground">{data.note}</p>
    </div>
  );
}

function CompetencyRow({
  entry,
  data,
  open,
  toggle,
}: {
  entry: CompetencyEvidence;
  data: StaffAssessment;
  open: string | null;
  toggle: (key: string) => void;
}) {
  const resume = entry.items.filter((i) => i.sourceType === "RESUME");
  const interview = entry.items.filter((i): i is Extract<EvidenceItem, { sourceType: "INTERVIEW" }> => i.sourceType === "INTERVIEW");
  const practical = entry.items.filter((i) => i.sourceType === "CODING" || i.sourceType === "SQL");
  const key = `${entry.competencyId ?? "x"}:${entry.competency}`;
  const isOpen = open === key;
  const answered = interview.filter((i) => i.result.answered).length;
  const questionsById = new Map((data.interview?.questions ?? []).map((q) => [q.id, q]));
  const practicalById = new Map(data.practicals.map((p) => [p.id, p]));

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {entry.competency}
            {!entry.inBlueprint ? <span className="ml-2 text-[11px] text-muted-foreground">(not in current blueprint)</span> : null}
          </p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
            {resume.map((i) => (
              <li key={i.sourceId}>
                {SOURCE_LABEL.RESUME}: {evidenceLabel(i)}
              </li>
            ))}
            {interview.length > 0 ? (
              <li>
                {SOURCE_LABEL.INTERVIEW}: {evidenceLabel(interview[0]!, answered)}
              </li>
            ) : null}
            {practical.map((i) => (
              <li key={i.sourceId}>
                {SOURCE_LABEL[i.sourceType]}: {evidenceLabel(i)}
              </li>
            ))}
            {entry.items.length === 0 ? <li>No evidence yet</li> : null}
          </ul>
        </div>
        {entry.items.length > 0 ? (
          <Button variant="ghost" size="xs" onClick={() => toggle(key)}>
            {isOpen ? "Hide" : "Trace"}
          </Button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-[13px]">
          {resume.map((i) =>
            i.sourceType === "RESUME" ? (
              <div key={i.sourceId}>
                <p className="font-medium text-foreground">Resume → {entry.competency}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {i.result.quotes.map((q, idx) => (
                    <li key={idx}>&ldquo;{q}&rdquo;</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {interview.map((i) => {
            const q = questionsById.get(i.sourceId);
            return q ? <InterviewTrace key={i.sourceId} q={q} /> : null;
          })}
          {practical.map((i) => {
            const p = practicalById.get(i.sourceId);
            if (!p) return null;
            return (
              <div key={i.sourceId} className="space-y-0.5">
                <p className="font-medium text-foreground">
                  {p.type === "SQL" ? "SQL" : "Coding"} assessment → {p.title}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({p.taskKey} v{p.taskVersion} · {p.difficulty.toLowerCase()} · {p.required ? "required" : "optional"})
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Submission: {p.submittedAt ? `${p.language ?? ""} · submitted ${fmt(p.submittedAt)}` : "not submitted"}
                  {p.executedAt ? ` · executed ${fmt(p.executedAt)}` : ""}
                </p>
                <p className="text-foreground">Result: {practicalResultLine(p)}</p>
              </div>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

function InterviewTrace({ q }: { q: StaffInterviewQuestion }) {
  return (
    <div className="space-y-1">
      <p className="font-medium text-foreground">
        Interview question {q.sequence}
        <span className="ml-2 font-normal text-muted-foreground">
          {q.blueprint
            ? `${q.blueprint.stageTitle} · ${q.blueprint.type.toLowerCase().replace(/_/g, " ")} · difficulty ${q.blueprint.difficulty} · ${
                q.blueprint.generationMode === "AI_GENERATED" ? "AI-generated wording" : "deterministic wording"
              }`
            : `engine ${String(q.action ?? "question").toLowerCase().replace(/_/g, " ")}`}
        </span>
      </p>
      <p className="whitespace-pre-wrap break-words text-foreground">{q.question}</p>
      {q.blueprint ? (
        <p className="text-muted-foreground">
          Expected evidence: {q.blueprint.expectedEvidence.join("; ")} · Rubric: {q.blueprint.rubric.map((r) => `${r.name} (${r.weight})`).join(", ")}
        </p>
      ) : null}
      <p className="text-muted-foreground">Candidate answer{q.answer ? ` · ${fmt(q.answer.answeredAt)}` : ""}:</p>
      <p className="whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 text-foreground">
        {q.answer ? q.answer.text : "No answer recorded"}
      </p>
    </div>
  );
}
