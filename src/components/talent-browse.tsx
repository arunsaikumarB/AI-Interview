"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AddToJob } from "@/components/add-to-job";
import { STAGE_LABELS } from "@/lib/constants";
import type { PipelineStage } from "@prisma/client";

type JobOption = { id: string; title: string; status: string; location: string | null };

type Row = {
  id: string;
  name: string;
  email: string;
  experience: number;
  skills: string[];
  location: string | null;
  hasResume: boolean;
  inHiring: { applicationId: string; jobTitle: string; stage: string } | null;
  applications: { jobTitle: string; jobClosed: boolean; appliedAt: string; source: string | null }[];
  sources: string[];
  addedAt: string;
};

type Page = { rows: Row[]; total: number; page: number; pageSize: number; pageCount: number };

const SOURCE_LABELS: Record<string, string> = {
  careers_site: "Careers",
  resume_parser: "Resume Parser",
  resume_upload: "Uploaded resume",
  added_by_staff: "Added by staff",
  no_application: "Uploaded, no job",
  bulk_import: "Bulk import",
  other: "Other",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const EMPTY = { q: "", role: "", minExp: "", maxExp: "", year: "", month: "", skills: "", source: "", hiring: "all" };
type Filters = typeof EMPTY;

const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground";
const labelClass = "text-[13px] font-medium text-muted-foreground";

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export function TalentBrowse({ jobs }: { jobs: JobOption[] }) {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);

  const load = useCallback(async (f: Filters, p: number, signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v && !(k === "hiring" && v === "all")) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    try {
      const res = await fetch(`/api/talent/browse?${sp.toString()}`, { signal });
      const body = (await res.json().catch(() => null)) as (Page & { error?: string }) | null;
      if (!res.ok || !body || !Array.isArray(body.rows)) {
        setError(body?.error ?? "Could not search the talent pool. Try again.");
        return;
      }
      setData(body);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") setError("Could not reach HireOS. Check your connection and try again.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(applied, page, controller.signal);
    return () => controller.abort();
  }, [applied, page, load]);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value, ...(k === "year" && !e.target.value ? { month: "" } : {}) }));

  function search(e: React.FormEvent) {
    e.preventDefault();
    setAddingFor(null);
    setPage(1);
    setApplied({ ...draft });
  }

  function clear() {
    setDraft(EMPTY);
    setAddingFor(null);
    setPage(1);
    setApplied(EMPTY);
  }

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2009 }, (_, i) => String(thisYear - i));

  return (
    <section className="space-y-4" aria-labelledby="talent-browse-heading">
      <div>
        <h2 id="talent-browse-heading" className="text-[17px] font-semibold text-foreground">
          Search historical and available candidates
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Every filter must match. Role, year, month and source match the same application. Results are
          read from the server one page at a time. No AI runs here.
        </p>
      </div>

      <form onSubmit={search} className="rounded-xl border border-border bg-card/80 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className={labelClass}>Name or email</span>
            <input className={inputClass} value={draft.q} onChange={set("q")} maxLength={100} />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Job role</span>
            <input className={inputClass} value={draft.role} onChange={set("role")} maxLength={200} placeholder="e.g. .NET Developer" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className={labelClass}>Experience from (yrs)</span>
              <input className={inputClass} type="number" min={0} max={60} step="0.5" value={draft.minExp} onChange={set("minExp")} />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>to (yrs)</span>
              <input className={inputClass} type="number" min={0} max={60} step="0.5" value={draft.maxExp} onChange={set("maxExp")} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className={labelClass}>Year applied</span>
              <select className={inputClass} value={draft.year} onChange={set("year")}>
                <option value="">Any</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Month</span>
              <select className={inputClass} value={draft.month} onChange={set("month")} disabled={!draft.year}>
                <option value="">Any</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="space-y-1">
            <span className={labelClass}>Skills (comma separated)</span>
            <input className={inputClass} value={draft.skills} onChange={set("skills")} maxLength={300} placeholder="e.g. C#, SQL" />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Source</span>
            <select className={inputClass} value={draft.source} onChange={set("source")}>
              <option value="">Any</option>
              {["resume_parser", "careers_site", "resume_upload", "added_by_staff", "no_application"].map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Hiring status</span>
            <select className={inputClass} value={draft.hiring} onChange={set("hiring")}>
              <option value="all">Everyone</option>
              <option value="not_in_hiring">Not in hiring</option>
              <option value="in_hiring">In hiring</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Searching…" : "Search"}
            </Button>
            <Button type="button" variant="outline" onClick={clear} disabled={loading}>
              Clear
            </Button>
          </div>
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {data ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Candidate</th>
                <th className="px-4 py-3 font-medium">Experience</th>
                <th className="px-4 py-3 font-medium">Applied for</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Hiring</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/candidates/${r.id}`} className="font-medium text-foreground hover:underline">
                      {r.name || r.email}
                    </Link>
                    <p className="text-xs text-muted-foreground">{r.email}</p>
                    {r.skills.length > 0 ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.skills.join(", ")}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.experience} yr{r.experience === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.applications.length === 0 ? (
                      <span>Added {dateText(r.addedAt)} · no job</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {r.applications.map((a, i) => (
                          <li key={i}>
                            <span className="text-foreground/90">{a.jobTitle}</span>
                            {a.jobClosed ? " (closed)" : ""} · {dateText(a.appliedAt)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.sources.map((s) => SOURCE_LABELS[s] ?? SOURCE_LABELS.other).join(", ")}
                  </td>
                  <td className="px-4 py-3">
                    {r.inHiring ? (
                      <Link
                        href={`/dashboard/candidates/${r.id}?applicationId=${r.inHiring.applicationId}`}
                        className="text-foreground/90 hover:underline"
                      >
                        In hiring: {r.inHiring.jobTitle}
                        <span className="block text-xs text-muted-foreground">
                          {STAGE_LABELS[r.inHiring.stage as PipelineStage] ?? r.inHiring.stage}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Not in hiring</span>
                    )}
                    <div className="mt-2">
                      {addingFor === r.id ? (
                        <AddToJob candidateId={r.id} jobs={jobs} />
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={() => setAddingFor(r.id)}>
                          Add to Hiring
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No one matches these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>
            Showing {(data.page - 1) * data.pageSize + 1}–{(data.page - 1) * data.pageSize + data.rows.length} of {data.total}
          </p>
          {data.pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>
                Previous
              </Button>
              <span className="tabular-nums">
                Page {data.page} of {data.pageCount}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || data.page >= data.pageCount}
                onClick={() => setPage(data.page + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
