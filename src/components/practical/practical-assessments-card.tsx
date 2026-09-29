"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ASSESSMENT_CHANGED_EVENT } from "@/lib/candidate-assessment/events";
import { cn } from "@/lib/utils";

type Summary = {
  id: string;
  type: "CODING" | "SQL";
  title: string;
  taskKey: string;
  taskVersion: number;
  competency: string;
  difficulty: string;
  status: string;
  timeLimitMinutes: number;
  tokenExpiresAt: string;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  evidence: { execStatus: string; passed: number | null; total: number | null; runtimeMs: number | null } | null;
};

type TestRow = { id: string; name: string; visible: boolean; outcome: string; runtimeMs: number | null };

type Detail = Summary & {
  provenance: {
    recommendation?: { type?: string; title?: string; competency?: string };
    runtimeMatchesRecommendation?: boolean;
    competencySource?: string;
    engineVersion?: string;
  } | null;
  submission: {
    id: string;
    language: string;
    languageLabel: string;
    source: string;
    sourceSha256: string;
    sizeBytes: number;
    taskVersion: number;
    runnerVersion: string;
    execStatus: string;
    submittedAt: string;
    executedAt: string | null;
    result: {
      kind?: string;
      status?: string;
      passed?: number;
      failed?: number;
      total?: number;
      runtimeMs?: number | null;
      memoryMb?: number | null;
      compileError?: boolean;
      compileErrorMessage?: string | null;
      timedOut?: boolean;
      resourceViolation?: string | null;
      tests?: TestRow[];
      correct?: boolean;
      rowCount?: number | null;
      columnCount?: number | null;
      mismatch?: string | null;
      rowLimitExceeded?: boolean;
      sqlState?: string | null;
      errorMessage?: string | null;
      reason?: string;
      attempts?: number | null;
    } | null;
  } | null;
};

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  STARTED: "Started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  EXECUTING: "Executing",
  COMPLETED: "Executed",
  EXECUTION_FAILED: "Execution failed",
  TIMEOUT: "Timed out",
  CANCELLED: "Cancelled",
};

const OUTCOME_LABEL: Record<string, string> = {
  PASSED: "Passed",
  WRONG_OUTPUT: "Wrong output",
  RUNTIME_ERROR: "Runtime error",
  TIMEOUT: "Time limit",
  OUTPUT_LIMIT: "Output limit",
  MEMORY_LIMIT: "Memory limit",
  NOT_RUN: "Not run",
};

const MISMATCH_LABEL: Record<string, string> = {
  COLUMN_COUNT: "Different number of columns",
  COLUMN_NAMES: "Different column names",
  ROW_COUNT: "Different number of rows",
  VALUES: "Different values",
  ORDER: "Correct rows in the wrong order",
};

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function evidenceLine(s: Summary): string {
  if (!s.evidence) return "No submission yet";
  const e = s.evidence;
  if (e.execStatus === "PENDING" || e.execStatus === "EXECUTING") return "Execution in progress";
  if (e.execStatus === "EXECUTION_FAILED" && e.total === null) return "Not executed (infrastructure failure)";
  const tests = e.passed !== null && e.total !== null ? `${e.passed} / ${e.total} ${s.type === "SQL" ? "dataset match" : "tests passed"}` : "—";
  return e.runtimeMs !== null ? `${tests} · ${e.runtimeMs} ms` : tests;
}

export function PracticalAssessmentsCard({ applicationId }: { applicationId: string }) {
  const base = `/api/applications/${encodeURIComponent(applicationId)}/practical-assessments`;
  const [items, setItems] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; type: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not load practical assessments");
        return;
      }
      setItems(body.assessments as Summary[]);
    } catch {
      setError("Could not load practical assessments");
    }
  }, [base]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(ASSESSMENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ASSESSMENT_CHANGED_EVENT, onChange);
  }, [load]);

  const notifyChanged = () => window.dispatchEvent(new Event(ASSESSMENT_CHANGED_EVENT));

  async function assign(type: "CODING" | "SQL") {
    setBusy(`assign-${type}`);
    setError(null);
    setLink(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not assign the assessment");
        return;
      }
      setLink({ url: `${window.location.origin}${body.candidatePath}`, type });
      setCopied(false);
      notifyChanged();
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: string) {
    setBusy(`cancel-${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/practical-assessments/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Could not cancel the assessment");
      notifyChanged();
    } finally {
      setBusy(null);
    }
  }

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    const res = await fetch(`/api/practical-assessments/${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setDetail(body as Detail);
    else setError(body.error ?? "Could not load evidence");
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const hasActive = (type: string) =>
    (items ?? []).some((i) => i.type === type && ["NOT_STARTED", "STARTED", "IN_PROGRESS", "SUBMITTED", "EXECUTING"].includes(i.status));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold text-foreground">Practical assessment</h2>
          <p className="text-[13px] text-muted-foreground">
            Sandboxed coding and SQL tasks chosen from the job&apos;s assessment blueprint. Results are objective evidence for your
            review — not a hiring recommendation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => assign("CODING")} disabled={busy !== null || hasActive("CODING")}>
            {busy === "assign-CODING" ? "Assigning…" : "Assign coding"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => assign("SQL")} disabled={busy !== null || hasActive("SQL")}>
            {busy === "assign-SQL" ? "Assigning…" : "Assign SQL"}
          </Button>
        </div>
      </div>

      {link ? (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          <p className="text-foreground">
            Candidate link for the {link.type === "SQL" ? "SQL" : "coding"} assessment. It is shown only once — copy it now and send it to
            the candidate.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-muted/50 px-2 py-1 text-[12px]">{link.url}</code>
            <Button size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {items === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No practical assessment assigned yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {a.title} <span className="text-muted-foreground">· {a.type === "SQL" ? "SQL" : "Coding"} · {a.difficulty.toLowerCase()}</span>
                  </p>
                  <p className="text-[12px] text-muted-foreground">Competency: {a.competency}</p>
                  <p className="text-[12px] text-muted-foreground">{evidenceLine(a)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                      a.status === "COMPLETED" && "bg-primary/10 text-primary",
                      (a.status === "EXECUTION_FAILED" || a.status === "TIMEOUT" || a.status === "CANCELLED") && "bg-muted text-muted-foreground",
                      !["COMPLETED", "EXECUTION_FAILED", "TIMEOUT", "CANCELLED"].includes(a.status) && "bg-warning/15 text-warning",
                    )}
                  >
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                  {["NOT_STARTED", "STARTED", "IN_PROGRESS"].includes(a.status) ? (
                    <Button variant="ghost" size="xs" onClick={() => cancel(a.id)} disabled={busy !== null}>
                      Cancel
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="xs" onClick={() => toggle(a.id)}>
                    {openId === a.id ? "Hide" : "Details"}
                  </Button>
                </div>
              </div>
              {openId === a.id ? <DetailView detail={detail} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

function DetailView({ detail }: { detail: Detail | null }) {
  if (!detail) return <p className="mt-3 text-[13px] text-muted-foreground">Loading evidence…</p>;
  const sub = detail.submission;
  const r = sub?.result ?? null;
  const prov = detail.provenance;
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Row label="Assigned" value={fmt(detail.createdAt)} />
        <Row label="Started" value={fmt(detail.startedAt)} />
        <Row label="Submitted" value={fmt(detail.submittedAt)} />
        <Row label="Executed" value={fmt(sub?.executedAt ?? null)} />
        <Row label="Time limit" value={`${detail.timeLimitMinutes} min`} />
        <Row label="Link expires" value={fmt(detail.tokenExpiresAt)} />
        <Row label="Task" value={`${detail.taskKey} v${detail.taskVersion}`} />
        <Row
          label="Blueprint source"
          value={
            prov?.competencySource === "PRACTICAL_RECOMMENDATION"
              ? `Recommended practical (${prov.recommendation?.title ?? "—"})`
              : "Blueprint competency"
          }
        />
      </dl>

      {!sub ? (
        <p className="text-[13px] text-muted-foreground">No submission.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Row label="Execution" value={STATUS_LABEL[sub.execStatus] ?? sub.execStatus} />
            <Row label="Language" value={sub.languageLabel} />
            {r && typeof r.total === "number" ? (
              <Row label={detail.type === "SQL" ? "Dataset match" : "Tests passed"} value={`${r.passed ?? 0} / ${r.total}`} />
            ) : null}
            {r && typeof r.runtimeMs === "number" ? <Row label="Runtime" value={`${r.runtimeMs} ms`} /> : null}
            {r && typeof r.memoryMb === "number" ? <Row label="Peak memory" value={`${r.memoryMb} MB`} /> : null}
            {r?.timedOut ? <Row label="Timeout" value="Yes" /> : null}
            {r?.resourceViolation ? <Row label="Resource limit" value={r.resourceViolation.toLowerCase()} /> : null}
            {detail.type === "SQL" && r && typeof r.rowCount === "number" ? (
              <Row label="Rows / columns returned" value={`${r.rowCount} / ${r.columnCount ?? "—"}`} />
            ) : null}
            {r?.mismatch ? <Row label="Dataset difference" value={MISMATCH_LABEL[r.mismatch] ?? r.mismatch} /> : null}
            {r?.kind === "INFRASTRUCTURE" ? (
              <Row label="Failure" value={`${r.reason ?? "unknown"}${r.attempts ? ` after ${r.attempts} attempts` : ""}`} />
            ) : null}
          </dl>

          {r?.compileErrorMessage ? (
            <div>
              <p className="text-[12px] font-medium text-foreground">Compile error</p>
              <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[12px]">{r.compileErrorMessage}</pre>
            </div>
          ) : null}
          {r?.errorMessage ? (
            <div>
              <p className="text-[12px] font-medium text-foreground">SQL error {r.sqlState ? `(${r.sqlState})` : ""}</p>
              <pre className="whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[12px]">{r.errorMessage}</pre>
            </div>
          ) : null}

          {r?.tests?.length ? (
            <div className="overflow-auto rounded border border-border">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-2 py-1 font-medium">Test</th>
                    <th className="px-2 py-1 font-medium">Set</th>
                    <th className="px-2 py-1 font-medium">Outcome</th>
                    <th className="px-2 py-1 font-medium">Runtime</th>
                  </tr>
                </thead>
                <tbody>
                  {r.tests.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="px-2 py-1">{t.name}</td>
                      <td className="px-2 py-1 text-muted-foreground">{t.visible ? "Example" : "Hidden"}</td>
                      <td className={cn("px-2 py-1", t.outcome === "PASSED" ? "text-success" : "text-muted-foreground")}>
                        {OUTCOME_LABEL[t.outcome] ?? t.outcome}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{t.runtimeMs !== null ? `${t.runtimeMs} ms` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div>
            <p className="text-[12px] font-medium text-foreground">Submitted {detail.type === "SQL" ? "query" : "code"}</p>
            <pre className="max-h-96 overflow-auto rounded bg-muted/40 p-2 font-mono text-[12px]">{sub.source}</pre>
            <p className="mt-1 break-all text-[11px] text-muted-foreground">
              SHA-256 {sub.sourceSha256} · {sub.sizeBytes} bytes · task v{sub.taskVersion} · {sub.runnerVersion}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
