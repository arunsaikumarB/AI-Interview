"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DATE_FORMATS,
  IMPORT_FIELDS,
  type ColumnMap,
  type DateFormat,
  type ImportFieldKey,
} from "@/lib/resume-parser-import/mapping";
import { RESUME_PARSER_LABEL } from "@/lib/resume-parser-import/constants";
import type { ImportReport } from "@/lib/resume-parser-import/importer";

const ENDPOINT = "/api/candidates/import/resume-parser";

type Columns = {
  header: string[];
  rowCount: number;
  sample: string[][];
  suggested: ColumnMap;
};

type Busy = "columns" | "validate" | "import" | null;

const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  DMY: "DD/MM/YYYY (31/12/2025)",
  MDY: "MM/DD/YYYY (12/31/2025)",
  YMD: "YYYY-MM-DD (2025-12-31)",
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground";

async function post(form: FormData): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(ENDPOINT, { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) return { ok: false, error: data?.error ?? "Something went wrong. Try again." };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not reach HireOS. Check your connection and try again." };
  }
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const duplicates = report.duplicatesInFile + report.duplicatesExisting;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={report.applied ? "Imported" : "Will be imported"}
          value={report.applicationsNew}
          hint={`applications · ${report.candidatesNew} new candidates, ${report.candidatesExisting} existing`}
        />
        <Stat label="Skipped" value={duplicates + report.errorRows} hint="duplicates + rows with errors" />
        <Stat
          label="Duplicates"
          value={duplicates}
          hint={`${report.duplicatesInFile} repeated in this file · ${report.duplicatesExisting} already in HireOS`}
        />
        <Stat label="Errors" value={report.errorRows} hint={`of ${report.totalRows} rows`} />
      </div>

      {report.jobsNew > 0 ? (
        <p className="text-sm text-muted-foreground">
          {report.applied ? "Created" : "Will create"} {report.jobsNew} Closed historical job
          {report.jobsNew === 1 ? "" : "s"} for roles with no matching job:{" "}
          {report.jobsNewTitles.join(", ")}
          {report.jobsNew > report.jobsNewTitles.length ? ", …" : ""}
        </p>
      ) : null}
      {report.missingDates > 0 ? (
        <p className="text-sm text-muted-foreground">
          {report.missingDates} row{report.missingDates === 1 ? " has" : "s have"} no application
          date; the import date is used.
        </p>
      ) : null}
      {report.blankExperience > 0 ? (
        <p className="text-sm text-muted-foreground">
          {report.blankExperience} row{report.blankExperience === 1 ? " has" : "s have"} no
          experience value; saved as 0 years.
        </p>
      ) : null}
      {report.unmappedColumns.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Columns not imported: {report.unmappedColumns.join(", ")}
        </p>
      ) : null}

      {report.errors.length > 0 ? (
        <div className="rounded-xl border border-border">
          <p className="border-b border-border px-4 py-2 text-sm font-medium text-foreground">
            Rows with errors (not imported)
            {report.errorRows > report.errors.length
              ? ` · first ${report.errors.length} of ${report.errorRows}`
              : ""}
          </p>
          <ul className="max-h-72 overflow-y-auto px-4 py-2 text-sm text-muted-foreground">
            {report.errors.map((e) => (
              <li key={e.rowNumber} className="py-0.5">
                Row {e.rowNumber}: {e.reasons.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ResumeParserImport() {
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<Columns | null>(null);
  const [mapping, setMapping] = useState<ColumnMap>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>("DMY");
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setColumns(null);
    setMapping({});
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function loadColumns(f: File) {
    setFile(f);
    setColumns(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setBusy("columns");
    const form = new FormData();
    form.set("mode", "columns");
    form.set("file", f);
    const res = await post(form);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const data = res.data as Columns;
    setColumns(data);
    setMapping(data.suggested);
  }

  async function run(mode: "validate" | "import") {
    if (!file) return;
    setError(null);
    setBusy(mode);
    const form = new FormData();
    form.set("mode", mode);
    form.set("file", file);
    form.set("mapping", JSON.stringify({ columns: mapping, dateFormat }));
    const res = await post(form);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      if (mode === "import") setPreview(null);
      return;
    }
    if (mode === "validate") setPreview(res.data as ImportReport);
    else {
      setResult(res.data as ImportReport);
      setPreview(null);
    }
  }

  function setField(field: ImportFieldKey, value: string) {
    setPreview(null);
    setMapping((prev) => {
      const next = { ...prev };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  if (result) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">
          Import finished. Imported records are marked {RESUME_PARSER_LABEL} in Candidates. Next,
          attach the resume files in Step 2 below.
        </p>
        <ReportView report={result} />
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/candidates"
            className="inline-flex h-8 items-center rounded-[12px] border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/70"
          >
            Go to Candidates
          </Link>
          <Button variant="outline" onClick={reset}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="rp-file" className="text-sm font-medium text-foreground">
          1. CSV file
        </label>
        <input
          id="rp-file"
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          disabled={busy !== null}
          className="block text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadColumns(f);
          }}
        />
        <p className="text-xs text-muted-foreground">
          CSV only, up to 20 MB / 25,000 rows. From Excel use Save As &quot;CSV UTF-8 (Comma
          delimited)&quot;.
        </p>
        {busy === "columns" ? <p className="text-sm text-muted-foreground">Reading file…</p> : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {columns ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              2. Choose which column holds each field
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {columns.rowCount} rows found. Columns were pre-selected from their headings; check
              each one.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {IMPORT_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label htmlFor={`rp-${f.key}`} className="text-sm text-foreground">
                  {f.label}
                </label>
                <select
                  id={`rp-${f.key}`}
                  className={selectClass}
                  disabled={busy !== null}
                  value={mapping[f.key] === undefined ? "" : String(mapping[f.key])}
                  onChange={(e) => setField(f.key, e.target.value)}
                >
                  <option value="">— Not in file —</option>
                  {columns.header.map((h, i) =>
                    h ? (
                      <option key={i} value={i}>
                        {h}
                        {columns.sample[0]?.[i] ? ` (e.g. ${columns.sample[0][i].slice(0, 40)})` : ""}
                      </option>
                    ) : null,
                  )}
                </select>
                {f.hint ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
              </div>
            ))}
            <div className="space-y-1">
              <label htmlFor="rp-date-format" className="text-sm text-foreground">
                Date format in the file
              </label>
              <select
                id="rp-date-format"
                className={selectClass}
                disabled={busy !== null}
                value={dateFormat}
                onChange={(e) => {
                  setPreview(null);
                  setDateFormat(e.target.value as DateFormat);
                }}
              >
                {DATE_FORMATS.map((d) => (
                  <option key={d} value={d}>
                    {DATE_FORMAT_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void run("validate")} disabled={busy !== null}>
              {busy === "validate" ? "Checking…" : "3. Check file"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={busy !== null}>
              Start over
            </Button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-4">
          <p className="text-sm font-medium text-foreground">Check result (nothing saved yet)</p>
          <ReportView report={preview} />
          {preview.applicationsNew > 0 ? (
            <Button onClick={() => void run("import")} disabled={busy !== null}>
              {busy === "import"
                ? "Importing…"
                : `4. Import ${preview.applicationsNew} application${preview.applicationsNew === 1 ? "" : "s"}`}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing new to import.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
