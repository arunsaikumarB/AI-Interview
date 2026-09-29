"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { CandidateCodingTaskView, CandidateSqlTaskView, CandidateTaskView, SqlCell } from "@/lib/practical/types";
import { cn } from "@/lib/utils";

type State = {
  type: "CODING" | "SQL";
  status: string;
  title: string;
  timeLimitMinutes: number;
  linkExpired: boolean;
  startedAt: string | null;
  endsAt: string | null;
  submittedAt: string | null;
  serverNow: string;
  task: CandidateTaskView | null;
  draft: { language: string; source: string } | null;
};

type CodingRun = {
  kind: "CODING";
  status: string;
  compileError: string | null;
  passed: number;
  total: number;
  tests: { name: string; outcome: string; stdout: string; stderr: string; runtimeMs: number | null }[];
};

type SqlRun = {
  kind: "SQL";
  status: string;
  columns: string[];
  rows: SqlCell[][];
  rowCount: number;
  truncated: boolean;
  error: string | null;
  runtimeMs: number | null;
};

const SUBMITTED_STATES = new Set(["SUBMITTED", "EXECUTING", "COMPLETED", "EXECUTION_FAILED"]);
const AUTOSAVE_MS = 2500;

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: body.error ?? "Something went wrong" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: "Network error — check your connection and try again." };
  }
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const OUTCOME_LABEL: Record<string, string> = {
  PASSED: "Passed",
  WRONG_OUTPUT: "Wrong output",
  RUNTIME_ERROR: "Runtime error",
  TIMEOUT: "Time limit exceeded",
  OUTPUT_LIMIT: "Output limit exceeded",
  MEMORY_LIMIT: "Memory limit exceeded",
  NOT_RUN: "Not run",
};

export function PracticalRoom({ token }: { token: string }) {
  const base = `/api/practical/${encodeURIComponent(token)}`;
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "run" | "submit" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("");
  const [sources, setSources] = useState<Record<string, string>>({});
  const [runResult, setRunResult] = useState<CodingRun | SqlRun | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const offsetRef = useRef(0);
  const lastSavedRef = useRef<string>("");
  const autoSubmittedRef = useRef(false);

  const applyState = useCallback((s: State) => {
    offsetRef.current = new Date(s.serverNow).getTime() - Date.now();
    setState(s);
    if (s.task) {
      const initial: Record<string, string> = {};
      if (s.task.kind === "CODING") {
        for (const l of s.task.languages) initial[l.id] = s.task.starterCode[l.id];
      } else {
        initial[s.task.language.id] = s.task.starterQuery;
      }
      let lang: string = s.task.kind === "CODING" ? s.task.languages[0].id : s.task.language.id;
      if (s.draft && s.draft.language in initial) {
        initial[s.draft.language] = s.draft.source;
        lang = s.draft.language;
      }
      if (!lastSavedRef.current) lastSavedRef.current = `${lang}\u0000${initial[lang]}`;
      setSources((prev) => (Object.keys(prev).length ? prev : initial));
      setLanguage((prev) => prev || lang);
    }
  }, []);

  const load = useCallback(async () => {
    const res = await api<State>(base);
    if (!res.ok) {
      setLoadError(res.status === 400 || res.status === 404 ? "This assessment link is not valid." : res.error);
      return;
    }
    applyState(res.data);
  }, [base, applyState]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = state?.status === "STARTED" || state?.status === "IN_PROGRESS";
  const source = sources[language] ?? "";

  useEffect(() => {
    if (!editable) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [editable]);

  // Autosave — stores the draft only; never runs or submits.
  useEffect(() => {
    if (!editable || !language || busy === "submit") return;
    const key = `${language}\u0000${source}`;
    if (key === lastSavedRef.current) return;
    const id = window.setTimeout(async () => {
      const res = await api<{ savedAt: string }>(`${base}/draft`, {
        method: "PUT",
        body: JSON.stringify({ language, source }),
      });
      if (res.ok) {
        lastSavedRef.current = key;
        setSavedAt(res.data.savedAt);
        setSaveError(false);
      } else {
        setSaveError(true);
        if (res.status === 409) void load();
      }
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(id);
  }, [editable, language, source, base, busy, load]);

  const remainingMs = useMemo(() => {
    if (!state?.endsAt) return null;
    return new Date(state.endsAt).getTime() - (now + offsetRef.current);
  }, [state?.endsAt, now]);

  const submit = useCallback(async () => {
    setBusy("submit");
    setActionError(null);
    setConfirmSubmit(false);
    const res = await api<{ status: string }>(`${base}/submit`, {
      method: "POST",
      body: JSON.stringify({ language, source }),
    });
    setBusy(null);
    if (!res.ok) {
      setActionError(res.error);
      if (res.status === 409) void load();
      return;
    }
    await load();
  }, [base, language, source, load]);

  // When time runs out, the current work is submitted once (within the server grace period).
  useEffect(() => {
    if (!editable || remainingMs === null || remainingMs > 0 || autoSubmittedRef.current || busy === "submit") return;
    autoSubmittedRef.current = true;
    if (source.trim()) void submit();
    else void load();
  }, [editable, remainingMs, source, busy, submit, load]);

  async function start() {
    setBusy("start");
    setActionError(null);
    const res = await api<State>(`${base}/start`, { method: "POST", body: "{}" });
    setBusy(null);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    applyState(res.data);
  }

  async function run() {
    setBusy("run");
    setActionError(null);
    const res = await api<CodingRun | SqlRun>(`${base}/run`, {
      method: "POST",
      body: JSON.stringify({ language, source }),
    });
    setBusy(null);
    if (!res.ok) {
      setActionError(res.error);
      if (res.status === 409) void load();
      return;
    }
    setRunResult(res.data);
  }

  function onEditorKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const indent = state?.type === "SQL" ? "  " : "    ";
    const { selectionStart, selectionEnd, value } = el;
    const next = value.slice(0, selectionStart) + indent + value.slice(selectionEnd);
    setSources((prev) => ({ ...prev, [language]: next }));
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + indent.length;
    });
  }

  if (loadError) return <Notice title="Assessment unavailable" body={loadError} />;
  if (!state) return <Notice title="Loading assessment…" body="" />;

  const kindLabel = state.type === "SQL" ? "SQL assessment" : "Coding assessment";

  if (state.status === "NOT_STARTED") {
    return (
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-12">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">{kindLabel}</p>
        <h1 className="text-2xl font-semibold text-foreground">{state.title}</h1>
        {state.linkExpired ? (
          <p className="text-sm text-destructive">This assessment link has expired. Please contact the hiring team.</p>
        ) : (
          <>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>You have {state.timeLimitMinutes} minutes once you start. The timer keeps running if you close the page.</li>
              <li>
                {state.type === "SQL"
                  ? "Run your query as often as you like to see its result table."
                  : "Run your code against the example tests as often as you like."}{" "}
                Your work is saved automatically.
              </li>
              <li>You can submit once. When time runs out, your current work is submitted automatically.</li>
              <li>Your code runs in an isolated environment with no internet access.</li>
            </ul>
            <Button size="lg" onClick={start} disabled={busy !== null}>
              {busy === "start" ? "Starting…" : "Start assessment"}
            </Button>
            {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          </>
        )}
      </main>
    );
  }

  if (SUBMITTED_STATES.has(state.status)) {
    return (
      <Notice
        title="Submission received"
        body={`Thank you — your ${state.type === "SQL" ? "query" : "code"} was submitted${
          state.submittedAt ? ` at ${new Date(state.submittedAt).toLocaleTimeString()}` : ""
        }. The hiring team will review it. You can close this page.`}
      />
    );
  }
  if (state.status === "TIMEOUT") {
    return <Notice title="Time is up" body="The time limit for this assessment has passed and it was closed without a submission." />;
  }
  if (state.status === "CANCELLED") {
    return <Notice title="Assessment cancelled" body="The hiring team has cancelled this assessment. No action is needed." />;
  }
  if (!state.task) return <Notice title="Assessment unavailable" body="Please refresh the page." />;

  const task = state.task;
  const lowTime = remainingMs !== null && remainingMs < 5 * 60_000;

  return (
    <main className="mx-auto max-w-[1280px] space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{kindLabel}</p>
          <h1 className="text-xl font-semibold text-foreground">{task.title}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground" aria-live="polite">
            {saveError ? "Autosave failed — retrying" : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : "Not saved yet"}
          </span>
          <span
            className={cn("rounded-lg border px-3 py-1 font-mono tabular-nums", lowTime ? "border-destructive text-destructive" : "border-border")}
            aria-label="Time remaining"
          >
            {remainingMs !== null ? formatRemaining(remainingMs) : "—"}
          </span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass-card max-h-[calc(100dvh-140px)] space-y-4 overflow-auto rounded-[var(--radius-card)] p-5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{task.instructions}</p>
          {task.constraints.length ? (
            <div>
              <h2 className="text-[13px] font-semibold text-foreground">Constraints</h2>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
                {task.constraints.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {task.kind === "CODING" ? <CodingExamples task={task} /> : <SqlReference task={task} />}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {task.kind === "CODING" ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Language
                <select
                  className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={busy !== null}
                >
                  {task.languages.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-sm text-muted-foreground">{task.language.label}</span>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={run} disabled={busy !== null || !source.trim()}>
                {busy === "run" ? "Running…" : task.kind === "SQL" ? "Run query" : "Run code"}
              </Button>
              <Button onClick={() => setConfirmSubmit(true)} disabled={busy !== null || !source.trim()}>
                {busy === "submit" ? "Submitting…" : "Submit"}
              </Button>
            </div>
          </div>

          {confirmSubmit ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
              <span className="text-foreground">Submit now? You cannot change your answer afterwards.</span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => setConfirmSubmit(false)}>
                  Keep working
                </Button>
                <Button onClick={submit}>Submit final answer</Button>
              </div>
            </div>
          ) : null}

          <textarea
            aria-label={task.kind === "SQL" ? "SQL editor" : "Code editor"}
            className="h-[46dvh] w-full resize-y rounded-lg border border-border bg-muted/30 p-3 font-mono text-[13px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={source}
            onChange={(e) => setSources((prev) => ({ ...prev, [language]: e.target.value }))}
            onKeyDown={onEditorKey}
            disabled={busy === "submit"}
          />

          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          {runResult ? runResult.kind === "CODING" ? <CodingRunView run={runResult} /> : <SqlRunView run={runResult} /> : null}
        </section>
      </div>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-xl space-y-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      {body ? <p className="text-sm text-muted-foreground">{body}</p> : null}
    </main>
  );
}

function CodingExamples({ task }: { task: CandidateCodingTaskView }) {
  return (
    <div className="space-y-3">
      <h2 className="text-[13px] font-semibold text-foreground">Examples</h2>
      {task.examples.map((ex) => (
        <div key={ex.name} className="space-y-1">
          <p className="text-[12px] font-medium text-muted-foreground">{ex.name}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <pre className="overflow-auto rounded-md bg-muted/40 p-2 text-[12px]">{ex.input}</pre>
            <pre className="overflow-auto rounded-md bg-muted/40 p-2 text-[12px]">{ex.expected}</pre>
          </div>
        </div>
      ))}
      <p className="text-[12px] text-muted-foreground">
        Your submission is also checked against {task.hiddenTestCount} additional tests that are not shown. Limits:{" "}
        {task.limits.perTestTimeoutMs / 1000}s and {task.limits.memoryMb} MB per test.
      </p>
    </div>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: SqlCell[][] }) {
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/40">
          <tr>
            {columns.map((c, i) => (
              <th key={`${c}-${i}`} className="px-2 py-1 text-left font-medium text-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((cell, j) => (
                <td key={j} className="px-2 py-1 font-mono text-muted-foreground">
                  {cell === null ? <span className="italic opacity-70">NULL</span> : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SqlReference({ task }: { task: CandidateSqlTaskView }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[13px] font-semibold text-foreground">Schema</h2>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {task.schema.map((t) => (
            <div key={t.name} className="rounded-md border border-border p-2">
              <p className="font-mono text-[12px] font-semibold text-foreground">{t.name}</p>
              <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
                {t.columns.map((c) => (
                  <li key={c.name} className="font-mono">
                    {c.name} <span className="opacity-70">{c.type}</span>
                    {c.note ? <span className="font-sans opacity-70"> — {c.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <h2 className="text-[13px] font-semibold text-foreground">Sample data</h2>
        {task.sampleData.map((s) => (
          <div key={s.table} className="space-y-1">
            <p className="font-mono text-[12px] text-muted-foreground">{s.table} (first rows)</p>
            <DataTable columns={s.columns} rows={s.rows} />
          </div>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        One read-only SELECT query. Limits: {task.limits.timeoutMs / 1000}s and {task.limits.maxRows} rows.
      </p>
    </div>
  );
}

function CodingRunView({ run }: { run: CodingRun }) {
  if (run.status === "COMPILE_ERROR") {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">Your code could not be compiled</p>
        <pre className="max-h-60 overflow-auto rounded-md bg-muted/40 p-2 text-[12px]">{run.compileError}</pre>
      </div>
    );
  }
  if (run.status !== "COMPLETED") {
    const msg =
      run.status === "TIMEOUT"
        ? "The run exceeded the overall time limit."
        : run.status === "RESOURCE_VIOLATION"
          ? "The run exceeded a resource limit (memory or output)."
          : "The run could not be completed. Please try again.";
    return <p className="text-sm text-destructive">{msg}</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">
        Example tests: {run.passed} of {run.total} passed
      </p>
      {run.tests.map((t) => (
        <details key={t.name} className="rounded-md border border-border p-2 text-[12px]" open={t.outcome !== "PASSED"}>
          <summary className="cursor-pointer">
            <span className={t.outcome === "PASSED" ? "text-success" : "text-destructive"}>{OUTCOME_LABEL[t.outcome] ?? t.outcome}</span>
            <span className="text-muted-foreground"> · {t.name}</span>
            {t.runtimeMs !== null ? <span className="text-muted-foreground"> · {t.runtimeMs} ms</span> : null}
          </summary>
          {t.stdout ? (
            <>
              <p className="mt-2 text-muted-foreground">Your output</p>
              <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2">{t.stdout}</pre>
            </>
          ) : null}
          {t.stderr ? (
            <>
              <p className="mt-2 text-muted-foreground">Error output</p>
              <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2">{t.stderr}</pre>
            </>
          ) : null}
        </details>
      ))}
    </div>
  );
}

function SqlRunView({ run }: { run: SqlRun }) {
  if (run.error) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">{run.status === "TIMEOUT" ? "Query timed out" : "Query error"}</p>
        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[12px]">{run.error}</pre>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {run.rowCount} row{run.rowCount === 1 ? "" : "s"}
        {run.runtimeMs !== null ? ` · ${run.runtimeMs} ms` : ""}
        {run.truncated ? " · result truncated at the row limit" : ""}
      </p>
      <DataTable columns={run.columns} rows={run.rows} />
    </div>
  );
}
