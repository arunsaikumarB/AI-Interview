"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isAllowedResumeFile, RESUME_MAX_BYTES } from "@/lib/resume/mime";
import {
  RESUME_BATCH_MAX_BYTES,
  RESUME_BATCH_MAX_FILES,
  RESUME_SELECTION_MAX_FILES,
} from "@/lib/resume-parser-import/constants";

const ENDPOINT = "/api/candidates/import/resume-parser/resumes";

type Status =
  | "ready"
  | "no_match"
  | "ambiguous"
  | "has_resume"
  | "attached"
  | "invalid"
  | "failed"
  | "duplicate_name";

type Result = { name: string; status: Status; parsed?: boolean; reason?: string };

const STATUS_TEXT: Record<Exclude<Status, "ready" | "attached">, string> = {
  no_match: "no imported application names this file",
  ambiguous: "this file name is used by more than one candidate",
  has_resume: "candidate already has a resume (left unchanged)",
  invalid: "not allowed",
  failed: "could not be saved; try again",
  duplicate_name: "same file name selected twice",
};

function localCheck(file: File): string | null {
  if (!isAllowedResumeFile(file)) return "must be PDF, DOCX or TXT";
  if (file.size === 0) return "file is empty";
  if (file.size > RESUME_MAX_BYTES) return "file is larger than 10 MB";
  return null;
}

function batches(files: File[]): File[][] {
  const out: File[][] = [];
  let current: File[] = [];
  let bytes = 0;
  for (const f of files) {
    if (current.length > 0 && (current.length >= RESUME_BATCH_MAX_FILES || bytes + f.size > RESUME_BATCH_MAX_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f);
    bytes += f.size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

async function post(form: FormData): Promise<{ ok: true; results: Result[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(ENDPOINT, { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as { error?: string; results?: Result[] } | null;
    if (!res.ok || !data?.results) return { ok: false, error: data?.error ?? "Something went wrong. Try again." };
    return { ok: true, results: data.results };
  } catch {
    return { ok: false, error: "Could not reach HireOS. Check your connection and try again." };
  }
}

function Problems({ results }: { results: Result[] }) {
  const problems = results.filter((r) => r.status !== "ready" && r.status !== "attached");
  if (problems.length === 0) return null;
  return (
    <div className="rounded-xl border border-border">
      <p className="border-b border-border px-4 py-2 text-sm font-medium text-foreground">
        Files not attached{problems.length > 200 ? ` · first 200 of ${problems.length}` : ""}
      </p>
      <ul className="max-h-72 overflow-y-auto px-4 py-2 text-sm text-muted-foreground">
        {problems.slice(0, 200).map((r, i) => (
          <li key={`${r.name}-${i}`} className="break-all py-0.5">
            {r.name}: {r.reason ?? STATUS_TEXT[r.status as keyof typeof STATUS_TEXT]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResumeParserResumes() {
  const [files, setFiles] = useState<File[]>([]);
  const [checked, setChecked] = useState<Result[] | null>(null);
  const [done, setDone] = useState<Result[] | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset(clearInput = true) {
    setFiles([]);
    setChecked(null);
    setDone(null);
    setProgress(null);
    setError(null);
    if (clearInput && inputRef.current) inputRef.current.value = "";
  }

  async function check(selected: File[]) {
    reset(false);
    if (selected.length > RESUME_SELECTION_MAX_FILES) {
      setError(`Select at most ${RESUME_SELECTION_MAX_FILES} files at a time.`);
      return;
    }
    setFiles(selected);
    const seen = new Set<string>();
    const local: Result[] = selected.map((f) => {
      const key = f.name.toLowerCase();
      if (seen.has(key)) return { name: f.name, status: "duplicate_name" };
      seen.add(key);
      const problem = localCheck(f);
      return problem ? { name: f.name, status: "invalid", reason: problem } : { name: f.name, status: "ready" };
    });
    const toMatch = local.filter((r) => r.status === "ready").map((r) => r.name);
    if (toMatch.length === 0) {
      setChecked(local);
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("mode", "match");
    form.set("names", JSON.stringify(toMatch));
    const res = await post(form);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const byName = new Map(res.results.map((r) => [r.name, r]));
    setChecked(local.map((r) => (r.status === "ready" ? byName.get(r.name) ?? r : r)));
  }

  async function attach() {
    if (!checked) return;
    const readyNames = new Set(checked.filter((r) => r.status === "ready").map((r) => r.name));
    const ready = files.filter((f) => readyNames.has(f.name));
    const skipped = checked.filter((r) => r.status !== "ready");
    const results: Result[] = [];
    stopRef.current = false;
    setBusy(true);
    setError(null);
    setProgress({ sent: 0, total: ready.length });
    for (const batch of batches(ready)) {
      if (stopRef.current) break;
      const form = new FormData();
      form.set("mode", "attach");
      for (const f of batch) form.append("files", f, f.name);
      const res = await post(form);
      if (!res.ok) {
        setError(`${res.error} Files already attached are saved; select the same files again to continue.`);
        break;
      }
      results.push(...res.results);
      setProgress({ sent: results.length, total: ready.length });
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    const sent = new Set(results.map((r) => r.name));
    const unsent: Result[] = ready
      .filter((f) => !sent.has(f.name))
      .map((f) => ({ name: f.name, status: "failed", reason: "not sent; select it again to continue" }));
    setDone([...results, ...unsent, ...skipped]);
  }

  const count = (list: Result[], status: Status) => list.filter((r) => r.status === status).length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="rp-resumes" className="text-sm font-medium text-foreground">
          Resume files
        </label>
        <input
          id="rp-resumes"
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,application/pdf"
          disabled={busy}
          className="block text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            if (list.length > 0) void check(list);
          }}
        />
        <p className="text-xs text-muted-foreground">
          PDF, DOCX or TXT, up to 10 MB each and {RESUME_SELECTION_MAX_FILES} files at a time. Each
          file is matched by its file name to the &quot;Resume file name / link&quot; column of the
          imported CSV. Candidates who already have a resume are left unchanged.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {checked && !done ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            {count(checked, "ready")} of {checked.length} files ready to attach
            {count(checked, "ready") < checked.length ? " · the rest are listed below" : ""}.
          </p>
          <Problems results={checked} />
          <div className="flex flex-wrap items-center gap-2">
            {count(checked, "ready") > 0 ? (
              <Button onClick={() => void attach()} disabled={busy}>
                {progress
                  ? `Attaching… ${progress.sent} of ${progress.total}`
                  : `Attach ${count(checked, "ready")} resume${count(checked, "ready") === 1 ? "" : "s"}`}
              </Button>
            ) : null}
            {busy && progress ? (
              <Button variant="outline" onClick={() => (stopRef.current = true)}>
                Stop after this batch
              </Button>
            ) : (
              <Button variant="outline" onClick={() => reset()} disabled={busy}>
                Clear
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {busy && !progress ? <p className="text-sm text-muted-foreground">Checking file names…</p> : null}

      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Attached {count(done, "attached")} resume{count(done, "attached") === 1 ? "" : "s"}
            {done.some((r) => r.status === "attached" && r.parsed === false)
              ? ` (${done.filter((r) => r.status === "attached" && r.parsed === false).length} with no readable text, e.g. scanned PDFs; the file is still saved)`
              : ""}
            . Not attached: {done.filter((r) => r.status !== "attached").length}.
          </p>
          <Problems results={done} />
          <Button variant="outline" onClick={() => reset()}>
            Attach more files
          </Button>
        </div>
      ) : null}
    </div>
  );
}
