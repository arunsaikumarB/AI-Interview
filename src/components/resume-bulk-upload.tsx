"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { isAllowedResumeFile, RESUME_MAX_BYTES } from "@/lib/resume/mime";
import {
  UPLOAD_BATCH_MAX_BYTES,
  UPLOAD_BATCH_MAX_FILES,
  UPLOAD_SELECTION_MAX_FILES,
  rowWarnings,
  uploadRowSchema,
  type UploadRow,
} from "@/lib/resume-upload/constants";

const ENDPOINT = "/api/candidates/upload-resumes";

type JobOption = { id: string; title: string; status: string };

type PlanStatus = "new" | "link" | "exists" | "already_applied";
type SaveStatus = "created" | "linked" | "exists" | "already_applied" | "invalid" | "failed";

type Fields = { firstName: string; lastName: string; email: string; phone: string; experience: string };

type ProfileSummary = {
  skills: number;
  education: number;
  certifications: number;
  location: string;
  linkedIn: boolean;
  summary: boolean;
};

type Row = {
  file: File;
  status: PlanStatus | "invalid";
  reason?: string;
  parsed?: boolean;
  ocr?: boolean;
  profile?: ProfileSummary;
  include: boolean;
  emailEdited: boolean;
  fields: Fields;
  result?: { status: SaveStatus; reason?: string; parsed?: boolean };
};

type ReadResult =
  | { name: string; status: "invalid"; reason: string }
  | {
      name: string;
      status: PlanStatus;
      parsed: boolean;
      fields: { firstName: string; lastName: string; email: string; phone: string; experience: number | null };
      profile: ProfileSummary;
      needsOcr: boolean;
      ocr?: boolean;
    };

function profileText(p: ProfileSummary): string {
  const parts: string[] = [];
  if (p.skills) parts.push(`${p.skills} skill${p.skills === 1 ? "" : "s"}`);
  if (p.education) parts.push(`${p.education} education`);
  if (p.certifications) parts.push(`${p.certifications} certification${p.certifications === 1 ? "" : "s"}`);
  if (p.location) parts.push(p.location);
  if (p.linkedIn) parts.push("LinkedIn");
  if (p.summary) parts.push("summary");
  return parts.join(" · ");
}

type SaveResult = { name: string; status: SaveStatus; reason?: string; parsed?: boolean };

const EMPTY: Fields = { firstName: "", lastName: "", email: "", phone: "", experience: "" };

const PLAN_TEXT: Record<PlanStatus, string> = {
  new: "New candidate",
  link: "Already in HireOS · will be added to this job",
  exists: "Already in HireOS · nothing to add",
  already_applied: "Already applied to this job",
};

const RESULT_TEXT: Record<SaveStatus, string> = {
  created: "Saved",
  linked: "Added to the job",
  exists: "Already in HireOS · not changed",
  already_applied: "Already applied to this job",
  invalid: "Not saved",
  failed: "Not saved · try again",
};

const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:opacity-60";

function batches<T extends { file: File }>(items: T[]): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (current.length > 0 && (current.length >= UPLOAD_BATCH_MAX_FILES || bytes + item.file.size > UPLOAD_BATCH_MAX_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.file.size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

async function post<T>(form: FormData): Promise<{ ok: true; results: T[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(ENDPOINT, { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as { error?: string; results?: T[] } | null;
    if (!res.ok || !data?.results) return { ok: false, error: data?.error ?? "Something went wrong. Try again." };
    return { ok: true, results: data.results };
  } catch {
    return { ok: false, error: "Could not reach HireOS. Check your connection and try again." };
  }
}

function localProblem(file: File): string | null {
  if (!isAllowedResumeFile(file)) return "must be PDF, DOCX or TXT";
  if (file.size === 0) return "file is empty";
  if (file.size > RESUME_MAX_BYTES) return "file is larger than 10 MB";
  return null;
}

function toUploadRow(row: Row): { ok: true; data: UploadRow } | { ok: false; problem: string } {
  const exp = row.fields.experience.trim();
  const parsed = uploadRowSchema.safeParse({
    fileName: row.file.name,
    firstName: row.fields.firstName,
    lastName: row.fields.lastName,
    email: row.fields.email,
    phone: row.fields.phone,
    experience: exp === "" ? null : Number(exp),
  });
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, problem: parsed.error.issues[0]?.message ?? "check this row" };
}

export function ResumeBulkUpload({ jobs }: { jobs: JobOption[] }) {
  const [jobId, setJobId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<"idle" | "reading" | "scanning" | "review" | "saving" | "done">("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "reading" || phase === "scanning" || phase === "saving";

  function reset() {
    setRows([]);
    setPhase("idle");
    setProgress(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function read(selected: File[]) {
    setError(null);
    setRows([]);
    if (selected.length > UPLOAD_SELECTION_MAX_FILES) {
      setError(`Select at most ${UPLOAD_SELECTION_MAX_FILES} files at a time.`);
      return;
    }
    const seen = new Set<string>();
    const initial: Row[] = selected.map((file) => {
      const key = file.name.toLowerCase();
      const problem = seen.has(key) ? "same file name selected twice" : localProblem(file);
      seen.add(key);
      return problem
        ? { file, status: "invalid", reason: problem, include: false, emailEdited: false, fields: EMPTY }
        : { file, status: "new", include: true, emailEdited: false, fields: EMPTY };
    });
    const toRead = initial.filter((r) => r.status !== "invalid");
    setPhase("reading");
    setProgress({ done: 0, total: toRead.length });
    const byName = new Map<string, ReadResult>();
    for (const batch of batches(toRead)) {
      const form = new FormData();
      form.set("mode", "read");
      if (jobId) form.set("jobId", jobId);
      for (const r of batch) form.append("files", r.file, r.file.name);
      const res = await post<ReadResult>(form);
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        setProgress(null);
        return;
      }
      for (const r of res.results) byName.set(r.name, r);
      setProgress({ done: byName.size, total: toRead.length });
    }

    const toScan = toRead.filter((row) => {
      const r = byName.get(row.file.name);
      return r && r.status !== "invalid" && r.needsOcr;
    });
    if (toScan.length > 0) {
      setPhase("scanning");
      for (let i = 0; i < toScan.length; i++) {
        setProgress({ done: i, total: toScan.length });
        const form = new FormData();
        form.set("mode", "ocr");
        if (jobId) form.set("jobId", jobId);
        form.append("files", toScan[i].file, toScan[i].file.name);
        const res = await post<ReadResult>(form);
        const r = res.ok ? res.results[0] : undefined;
        if (r && r.status !== "invalid" && r.parsed) byName.set(r.name, r);
      }
    }

    setRows(
      initial.map((row) => {
        if (row.status === "invalid") return row;
        const r = byName.get(row.file.name);
        if (!r) return { ...row, status: "invalid", reason: "could not be read; try again", include: false };
        if (r.status === "invalid") return { ...row, status: "invalid", reason: r.reason, include: false };
        return {
          ...row,
          status: r.status,
          parsed: r.parsed,
          ocr: r.ocr,
          profile: r.profile,
          include: r.status === "new" || r.status === "link",
          fields: {
            firstName: r.fields.firstName,
            lastName: r.fields.lastName,
            email: r.fields.email,
            phone: r.fields.phone,
            experience: r.fields.experience === null ? "" : String(r.fields.experience),
          },
        };
      }),
    );
    setProgress(null);
    setPhase("review");
  }

  function update(i: number, patch: Partial<Fields>) {
    setRows((prev) =>
      prev.map((row, j) =>
        j === i ? { ...row, fields: { ...row.fields, ...patch }, emailEdited: row.emailEdited || "email" in patch } : row,
      ),
    );
  }

  const included = rows.filter((r) => r.include && r.status !== "invalid");
  const emailCount = new Map<string, number>();
  for (const r of included) {
    const e = r.fields.email.trim().toLowerCase();
    if (e) emailCount.set(e, (emailCount.get(e) ?? 0) + 1);
  }
  const problemOf = (row: Row): string | null => {
    if (!row.include || row.status === "invalid") return null;
    if (!row.fields.email.trim()) return "email is required";
    const checked = toUploadRow(row);
    if (!checked.ok) return checked.problem;
    if ((emailCount.get(checked.data.email) ?? 0) > 1) return "same email as another file";
    return null;
  };
  const problemCount = rows.filter((r) => problemOf(r)).length;

  async function save() {
    const items = rows
      .map((row, index) => ({ row, index, file: row.file, checked: toUploadRow(row) }))
      .filter((x) => x.row.include && x.row.status !== "invalid" && x.checked.ok);
    setError(null);
    setPhase("saving");
    setProgress({ done: 0, total: items.length });
    const results = new Map<string, SaveResult>();
    let failedMessage: string | null = null;
    for (const batch of batches(items)) {
      const form = new FormData();
      form.set("mode", "save");
      if (jobId) form.set("jobId", jobId);
      for (const x of batch) form.append("files", x.file, x.file.name);
      form.set("rows", JSON.stringify(batch.map((x) => (x.checked.ok ? x.checked.data : null))));
      const res = await post<SaveResult>(form);
      if (!res.ok) {
        failedMessage = res.error;
        break;
      }
      for (const r of res.results) results.set(r.name, r);
      setProgress({ done: results.size, total: items.length });
    }
    setRows((prev) =>
      prev.map((row) => {
        if (!row.include || row.status === "invalid") return row;
        const r = results.get(row.file.name);
        return {
          ...row,
          result: r
            ? { status: r.status, reason: r.reason, parsed: r.parsed }
            : { status: "failed", reason: "not sent; upload this file again" },
        };
      }),
    );
    if (failedMessage) setError(`${failedMessage} Files already saved are kept; upload the rest again.`);
    if (inputRef.current) inputRef.current.value = "";
    setProgress(null);
    setPhase("done");
  }

  const done = phase === "done";
  const count = (s: SaveStatus) => rows.filter((r) => r.result?.status === s).length;
  const notSaved = rows.filter((r) => r.result && (r.result.status === "invalid" || r.result.status === "failed")).length;
  const unreadSaved = rows.filter((r) => r.result?.status === "created" && r.result.parsed === false).length;
  const created = count("created");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="ru-job" className="text-sm font-medium text-foreground">
            Job (optional)
          </label>
          <select
            id="ru-job"
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
            value={jobId}
            disabled={phase !== "idle"}
            onChange={(e) => setJobId(e.target.value)}
          >
            <option value="">No job · add to talent pool only</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {j.status !== "OPEN" ? ` (${j.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            With a job, each candidate starts at Applied for that job and can be AI-screened.
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ru-files" className="text-sm font-medium text-foreground">
            Resume files
          </label>
          <input
            id="ru-files"
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,application/pdf"
            disabled={phase !== "idle"}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              if (list.length > 0) void read(list);
            }}
          />
          <p className="text-xs text-muted-foreground">
            PDF, DOCX or TXT, up to 10 MB each and {UPLOAD_SELECTION_MAX_FILES} files at a time. Text is read on
            this server only.
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {progress ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {phase === "reading"
            ? `Reading resumes… ${progress.done} of ${progress.total}`
            : phase === "scanning"
              ? `Reading scanned resume ${progress.done + 1} of ${progress.total}… (about 10–20 seconds each)`
              : `Saving… ${progress.done} of ${progress.total}`}
        </p>
      ) : null}

      {rows.length > 0 && phase !== "reading" && phase !== "scanning" ? (
        <div className="space-y-3">
          {done ? (
            <div className="space-y-1" aria-live="polite">
              <p className="text-sm text-foreground">
                Saved {created} new candidate{created === 1 ? "" : "s"}
                {count("linked") ? `, added ${count("linked")} existing to the job` : ""}
                {unreadSaved ? ` (${unreadSaved} with no readable text, e.g. scanned PDFs)` : ""}.
                {count("exists") + count("already_applied") ? ` Already in HireOS: ${count("exists") + count("already_applied")}.` : ""}
                {notSaved ? ` Not saved: ${notSaved}.` : ""}
              </p>
              {created > 0 ? (
                <p className="text-sm text-muted-foreground">
                  The local AI is now reading {created === 1 ? "this resume" : `these ${created} resumes`} again in the
                  background, one at a time (about 1–3 minutes each), to fill in details that are still empty. It
                  never changes what you entered.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-foreground">
              Check the details read from each resume and correct them if needed. Untick a file to skip it.
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <span className="sr-only">Include</span>
                  </th>
                  <th className="px-2 py-2">File</th>
                  <th className="px-2 py-2">First name</th>
                  <th className="px-2 py-2">Last name</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Phone</th>
                  <th className="w-24 px-2 py-2">Exp. (yrs)</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const problem = done ? null : problemOf(row);
                  const warnings = done || !row.include || row.status === "invalid" ? [] : rowWarnings(row.fields);
                  const locked = done || busy || row.status === "invalid";
                  const editable = !locked && row.include;
                  let statusText: string;
                  if (row.result) {
                    statusText = RESULT_TEXT[row.result.status] + (row.result.reason ? ` · ${row.result.reason}` : "");
                  } else if (row.status === "invalid") {
                    statusText = row.reason ?? "not allowed";
                  } else {
                    statusText = row.emailEdited ? "Checked when saved" : PLAN_TEXT[row.status];
                    if (row.parsed === false) statusText += " · no text read (scanned?)";
                    else if (row.ocr) statusText += " · read with OCR";
                  }
                  const alsoRead = !row.result && row.profile ? profileText(row.profile) : "";
                  return (
                    <tr key={`${row.file.name}-${i}`} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Include ${row.file.name}`}
                          checked={row.include}
                          disabled={locked}
                          onChange={(e) =>
                            setRows((prev) => prev.map((r, j) => (j === i ? { ...r, include: e.target.checked } : r)))
                          }
                        />
                      </td>
                      <td className="max-w-[180px] break-all px-2 py-2 text-xs text-muted-foreground">{row.file.name}</td>
                      {(["firstName", "lastName", "email", "phone"] as const).map((key) => (
                        <td key={key} className="px-2 py-1.5">
                          <input
                            className={inputClass}
                            aria-label={`${key} for ${row.file.name}`}
                            value={row.fields[key]}
                            disabled={!editable}
                            maxLength={key === "email" ? 254 : key === "phone" ? 30 : 100}
                            onChange={(e) => update(i, { [key]: e.target.value })}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <input
                          className={inputClass}
                          aria-label={`experience for ${row.file.name}`}
                          inputMode="decimal"
                          value={row.fields.experience}
                          disabled={!editable}
                          maxLength={4}
                          onChange={(e) => update(i, { experience: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {problem ? <span className="block text-destructive">{problem}</span> : null}
                        <span className="text-muted-foreground">
                          {problem ? (row.parsed === false ? "No text read (scanned?)" : null) : statusText}
                        </span>
                        {warnings.map((w) => (
                          <span key={w} className="block text-warning">
                            Check: {w}
                          </span>
                        ))}
                        {alsoRead ? <span className="block text-muted-foreground">Also read: {alsoRead}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {done ? (
              <>
                <Button variant="outline" onClick={reset}>
                  Upload more resumes
                </Button>
                <Link href="/dashboard/candidates" className={buttonVariants({ variant: "ghost" })}>
                  View candidates
                </Link>
              </>
            ) : (
              <>
                <Button onClick={() => void save()} disabled={busy || included.length === 0 || problemCount > 0}>
                  {phase === "saving"
                    ? "Saving…"
                    : `Save ${included.length} candidate${included.length === 1 ? "" : "s"}`}
                </Button>
                <Button variant="outline" onClick={reset} disabled={busy}>
                  Clear
                </Button>
                {problemCount > 0 ? (
                  <span className="text-sm text-destructive">
                    Fix or untick {problemCount} highlighted row{problemCount === 1 ? "" : "s"}.
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
