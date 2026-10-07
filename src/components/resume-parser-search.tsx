"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Profile = {
  id: number;
  name: string;
  email: string;
  location: string;
  experience: number | null;
  skills: string[];
  matchedSkills: string[];
  addedAt: string;
  fileName: string | null;
  candidateId: string | null;
};

type Page = { items: Profile[]; page: number; pageSize: number; total: number; totalPages: number };

export type ResumeParserJob = {
  id: string;
  title: string;
  skills: string[];
  experienceMin: number;
  experienceMax: number | null;
};

type RowState = { busy?: boolean; candidateId?: string; message?: string; note?: string; error?: string; inJob?: boolean };

type AddResponse = {
  status?: string;
  candidateId?: string;
  error?: string;
  job?: "added" | "already_in_job";
  jobTitle?: string;
  screening?: "started" | "busy" | "no_resume_text";
};

const SCREENING_NOTE: Record<NonNullable<AddResponse["screening"]>, string> = {
  started: "AI screening started. The result shows on the candidate page in a few minutes.",
  busy: "AI screening is busy. Run it from the candidate page.",
  no_resume_text: "No readable resume text, so AI screening was skipped.",
};

const EMPTY = { skills: "", anySkills: "", excludeSkills: "", minExperience: "", maxExperience: "", city: "", state: "" };
type Filters = typeof EMPTY;

const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground";
const labelClass = "text-[13px] font-medium text-muted-foreground";

function dateText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function ResumeParserSearch({ jobs }: { jobs: ResumeParserJob[] }) {
  const [jobId, setJobId] = useState("");
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters | null>(null);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<number, RowState>>({});

  async function load(f: Filters, page: number) {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v.trim()) sp.set(k, v.trim());
    if (page > 1) sp.set("page", String(page));
    try {
      const res = await fetch(`/api/talent/resume-parser/search?${sp.toString()}`);
      const body = (await res.json().catch(() => null)) as (Page & { error?: string }) | null;
      if (!res.ok || !body || !Array.isArray(body.items)) {
        setError(body?.error ?? "Could not search Resume Parser. Try again.");
        return;
      }
      setData(body);
      setRows({});
    } catch {
      setError("Could not reach HireOS. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  function run(f: Filters) {
    if (!f.skills.trim() && !f.anySkills.trim()) {
      setError("Enter at least one skill in “Has all of” or “Has any of”.");
      return;
    }
    setApplied({ ...f });
    void load(f, 1);
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    run(draft);
  }

  function chooseJob(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = jobs.find((j) => j.id === e.target.value) ?? null;
    setJobId(next?.id ?? "");
    setRows({});
    if (!next || next.skills.length === 0) return;
    const filled: Filters = {
      ...draft,
      skills: "",
      anySkills: next.skills.join(", ").slice(0, 600),
      minExperience: next.experienceMin > 0 ? String(next.experienceMin) : "",
      maxExperience: next.experienceMax != null ? String(next.experienceMax) : "",
    };
    setDraft(filled);
    run(filled);
  }

  async function add(p: Profile) {
    setRows((r) => ({ ...r, [p.id]: { busy: true } }));
    try {
      const res = await fetch("/api/talent/resume-parser/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job ? { profileId: p.id, jobId: job.id } : { profileId: p.id }),
      });
      const body = (await res.json().catch(() => null)) as AddResponse | null;
      if (!res.ok || !body?.candidateId) {
        setRows((r) => ({ ...r, [p.id]: { error: body?.error ?? "Could not add this profile. Try again." } }));
        return;
      }
      const candidateId = body.candidateId;
      if (body.job === "added") {
        const note = body.screening ? SCREENING_NOTE[body.screening] : undefined;
        setRows((r) => ({ ...r, [p.id]: { candidateId, inJob: true, message: `Added to ${body.jobTitle ?? "the job"}`, note } }));
      } else if (body.job === "already_in_job") {
        setRows((r) => ({ ...r, [p.id]: { candidateId, inJob: true, message: `Already in ${body.jobTitle ?? "this job"}` } }));
      } else {
        const message = body.status === "created" ? "Added to the Talent Pool" : "Already in HireOS";
        setRows((r) => ({ ...r, [p.id]: { candidateId, message } }));
      }
    } catch {
      setRows((r) => ({ ...r, [p.id]: { error: "Could not reach HireOS. Try again." } }));
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="resume-parser-heading">
      <div>
        <h2 id="resume-parser-heading" className="text-[17px] font-semibold text-foreground">
          Find profiles in Resume Parser
        </h2>
        <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
          Pick a job to search with its skills. Add to job downloads the resume, creates the candidate (existing
          candidates are never changed), puts them in that job at Applied and starts AI resume screening. AI
          screening is advice only and never moves anyone to another stage.
        </p>
      </div>

      <form onSubmit={search} className="space-y-3 rounded-xl border border-border bg-card/80 p-4">
        <label className="block max-w-md space-y-1">
          <span className={labelClass}>Job opening</span>
          <select className={inputClass} value={jobId} onChange={chooseJob}>
            <option value="">Talent Pool only (no job)</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
          {job && job.skills.length === 0 ? (
            <span className="block text-xs text-muted-foreground">This job has no skills listed. Type the skills below.</span>
          ) : null}
          {jobs.length === 0 ? (
            <span className="block text-xs text-muted-foreground">No open job openings. Profiles can still be added to the Talent Pool.</span>
          ) : null}
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className={labelClass}>Has all of (skills)</span>
            <input className={inputClass} value={draft.skills} onChange={set("skills")} maxLength={600} placeholder="e.g. Python, Django" />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Has any of (skills)</span>
            <input className={inputClass} value={draft.anySkills} onChange={set("anySkills")} maxLength={600} placeholder="e.g. Flask, FastAPI" />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Has none of (skills)</span>
            <input className={inputClass} value={draft.excludeSkills} onChange={set("excludeSkills")} maxLength={600} placeholder="e.g. PHP" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className={labelClass}>Experience from (yrs)</span>
              <input className={inputClass} type="number" min={0} max={60} step={1} value={draft.minExperience} onChange={set("minExperience")} />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>to (yrs)</span>
              <input className={inputClass} type="number" min={0} max={60} step={1} value={draft.maxExperience} onChange={set("maxExperience")} />
            </label>
          </div>
          <label className="space-y-1">
            <span className={labelClass}>City</span>
            <input className={inputClass} value={draft.city} onChange={set("city")} maxLength={80} />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>State</span>
            <input className={inputClass} value={draft.state} onChange={set("state")} maxLength={80} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Searching…" : "Search Resume Parser"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Type skills such as Python or Figma, not job titles.</p>
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
                <th className="px-4 py-3 font-medium">Profile</th>
                <th className="px-4 py-3 font-medium">Experience</th>
                <th className="px-4 py-3 font-medium">Skills</th>
                <th className="px-4 py-3 font-medium">In Resume Parser since</th>
                <th className="px-4 py-3 font-medium">HireOS</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => {
                const state = rows[p.id] ?? {};
                const candidateId = state.candidateId ?? p.candidateId;
                const matched = new Set(p.matchedSkills.map((s) => s.toLowerCase()));
                return (
                  <tr key={p.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{p.name || p.email || `Profile ${p.id}`}</p>
                      {p.email ? <p className="text-xs text-muted-foreground">{p.email}</p> : null}
                      {p.location ? <p className="text-xs text-muted-foreground">{p.location}</p> : null}
                      {p.fileName ? <p className="text-xs text-muted-foreground">{p.fileName}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.experience === null ? "—" : `${p.experience} yr${p.experience === 1 ? "" : "s"}`}
                    </td>
                    <td className="max-w-md px-4 py-3 text-xs text-muted-foreground">
                      {p.skills.map((s, i) => (
                        <span key={`${s}-${i}`}>
                          {i > 0 ? ", " : ""}
                          {matched.has(s.toLowerCase()) ? <strong className="font-semibold text-foreground">{s}</strong> : s}
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{dateText(p.addedAt)}</td>
                    <td className="px-4 py-3">
                      {candidateId ? (
                        <Link href={`/dashboard/candidates/${candidateId}`} className="text-foreground/90 hover:underline">
                          {state.message ?? "Already in HireOS"}
                          <span className="block text-xs text-muted-foreground">Open candidate</span>
                        </Link>
                      ) : null}
                      {state.note ? <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">{state.note}</p> : null}
                      {!candidateId || (job && !state.inJob) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={candidateId ? "mt-2" : undefined}
                          disabled={state.busy}
                          onClick={() => void add(p)}
                        >
                          {state.busy ? "Adding…" : job ? "Add to job" : "Add to Talent Pool"}
                        </Button>
                      ) : null}
                      {state.error ? (
                        <p role="alert" className="mt-1 max-w-[16rem] text-xs text-destructive">
                          {state.error}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No Resume Parser profiles match these skills.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.total > 0 && applied ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>
            Showing {(data.page - 1) * data.pageSize + 1}–{(data.page - 1) * data.pageSize + data.items.length} of {data.total}
          </p>
          {data.totalPages > 1 ? (
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={loading || data.page <= 1} onClick={() => void load(applied, data.page - 1)}>
                Previous
              </Button>
              <span className="tabular-nums">
                Page {data.page} of {data.totalPages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || data.page >= data.totalPages}
                onClick={() => void load(applied, data.page + 1)}
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
