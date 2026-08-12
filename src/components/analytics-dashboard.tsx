"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsPayload } from "@/lib/analytics";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </p>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function fmtDays(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n}d`;
}

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<
    "applications" | "inInterview" | "selected" | "rejected" | "title"
  >("applications");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/analytics", { cache: "no-store" });
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(json.error ?? "Failed to load analytics");
        return;
      }
      setData(json as AnalyticsPayload);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedJobs = useMemo(() => {
    if (!data) return [];
    const rows = [...data.perJob];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  }

  if (error) {
    return <p className="text-sm text-rose-600">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-slate-500">Loading analytics…</p>;
  }

  const maxFunnel = Math.max(1, ...data.funnel.stages.map((s) => s.count));
  const m = data.aiVsHuman.matrix;

  return (
    <div className="space-y-10">
      <Section
        title="Pipeline funnel"
        subtitle="Current-stage counts (matches the pipeline board). Conversion is adjacent-stage %."
      >
        {data.funnel.total === 0 ? (
          <Empty>No applications yet — funnel will appear when candidates apply.</Empty>
        ) : (
          <div className="space-y-2">
            {data.funnel.stages.map((s) => (
              <div key={s.stage} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
                <span className="text-slate-600">{s.label}</span>
                <div className="h-7 overflow-hidden rounded bg-slate-100">
                  <div
                    className="flex h-full items-center bg-slate-800 px-2 text-xs text-white transition-all"
                    style={{ width: `${Math.max(s.count > 0 ? 8 : 0, (s.count / maxFunnel) * 100)}%` }}
                  >
                    {s.count > 0 ? s.count : ""}
                  </div>
                </div>
                <span className="w-24 text-right tabular-nums text-slate-500">
                  {s.count}
                  {s.conversionFromPrev != null ? (
                    <span className="ml-1 text-xs">({s.conversionFromPrev}%)</span>
                  ) : null}
                </span>
              </div>
            ))}
            <p className="text-xs text-slate-500">Total applications: {data.funnel.total}</p>
          </div>
        )}
      </Section>

      <Section
        title="Time metrics"
        subtitle="From timeline history only (APPLICATION_CREATED → STAGE_CHANGED). Seed-created terminals without stage events are excluded."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["Time to shortlist", data.timeMetrics.timeToShortlist],
              ["Time to hire", data.timeMetrics.timeToHire],
            ] as const
          ).map(([label, metric]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-white/60 p-4"
            >
              <p className="text-sm font-medium text-slate-900">{label}</p>
              {metric.n === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  No qualifying transitions yet (n=0).
                </p>
              ) : (
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Median</dt>
                    <dd className="font-medium tabular-nums">{fmtDays(metric.medianDays)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Average</dt>
                    <dd className="font-medium tabular-nums">{fmtDays(metric.avgDays)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">n</dt>
                    <dd className="font-medium tabular-nums">{metric.n}</dd>
                  </div>
                </dl>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Per job" subtitle="Click a column header to sort.">
        {sortedJobs.length === 0 ? (
          <Empty>No jobs in this organization yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {(
                    [
                      ["title", "Job"],
                      ["applications", "Applications"],
                      ["inInterview", "In interview"],
                      ["selected", "Selected"],
                      ["rejected", "Rejected"],
                    ] as const
                  ).map(([key, label]) => (
                    <th key={key} className="px-4 py-3 font-medium">
                      <button
                        type="button"
                        className="hover:text-slate-900"
                        onClick={() => toggleSort(key)}
                      >
                        {label}
                        {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedJobs.map((j) => (
                  <tr key={j.jobId} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{j.title}</td>
                    <td className="px-4 py-3 tabular-nums">{j.applications}</td>
                    <td className="px-4 py-3 tabular-nums">{j.inInterview}</td>
                    <td className="px-4 py-3 tabular-nums">{j.selected}</td>
                    <td className="px-4 py-3 tabular-nums">{j.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="AI score distribution"
        subtitle="Latest INTERVIEW_OVERALL and RESUME_SCREEN overall scores (0–100 buckets)."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {(
            [
              ["Interview overall", data.scoreDistribution.interviewOverall],
              ["Resume screen", data.scoreDistribution.resumeScreen],
            ] as const
          ).map(([label, dist]) => (
            <div key={label} className="rounded-xl border border-slate-200 p-4">
              <p className="mb-2 text-sm font-medium text-slate-900">
                {label}{" "}
                <span className="font-normal text-slate-500">(n={dist.n})</span>
              </p>
              {dist.n === 0 ? (
                <Empty>No scores in this category yet.</Empty>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dist.buckets}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
                      <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#1e293b" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="AI vs human decisions">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {data.aiVsHuman.caption}
        </p>
        {data.aiVsHuman.n === 0 ? (
          <Empty>
            No paired cases yet (need latest INTERVIEW_OVERALL plus SELECTED/REJECTED).
            {data.aiVsHuman.neutralMaybe > 0
              ? ` ${data.aiVsHuman.neutralMaybe} MAYBE recommendation(s) excluded from the 2×2.`
              : ""}
          </Empty>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Agreement rate:{" "}
              <strong className="text-slate-900">
                {data.aiVsHuman.agreementRate ?? "—"}%
              </strong>{" "}
              (n={data.aiVsHuman.n}
              {data.aiVsHuman.neutralMaybe > 0
                ? `; ${data.aiVsHuman.neutralMaybe} MAYBE excluded`
                : ""}
              )
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-[320px] border-collapse text-center text-sm">
                <thead>
                  <tr>
                    <th className="p-2" />
                    <th className="p-2 font-medium text-slate-600">Human selected</th>
                    <th className="p-2 font-medium text-slate-600">Human rejected</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th className="p-2 text-left font-medium text-slate-600">AI positive</th>
                    <td className="border border-slate-200 bg-emerald-50 p-4 text-lg tabular-nums">
                      {m.aiPositiveHumanSelected}
                    </td>
                    <td className="border border-slate-200 bg-rose-50 p-4 text-lg tabular-nums">
                      {m.aiPositiveHumanRejected}
                    </td>
                  </tr>
                  <tr>
                    <th className="p-2 text-left font-medium text-slate-600">AI negative</th>
                    <td className="border border-slate-200 bg-rose-50 p-4 text-lg tabular-nums">
                      {m.aiNegativeHumanSelected}
                    </td>
                    <td className="border border-slate-200 bg-emerald-50 p-4 text-lg tabular-nums">
                      {m.aiNegativeHumanRejected}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-900">Disagreements</h3>
              {data.aiVsHuman.disagreements.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No disagreement cases in the matrix.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.aiVsHuman.disagreements.map((d) => (
                    <li
                      key={d.applicationId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="font-medium text-slate-900">{d.candidateName}</span>
                        <span className="text-slate-500"> · {d.jobTitle}</span>
                        <span className="block text-xs text-slate-500">
                          AI {d.aiRecommendation} ({d.aiSide}) vs human {d.humanStage}
                        </span>
                      </span>
                      {d.interviewId ? (
                        <Link
                          href={`/dashboard/interviews/${d.interviewId}`}
                          className="text-slate-900 underline"
                        >
                          Interview report
                        </Link>
                      ) : (
                        <Link
                          href={`/dashboard/candidates?applicationId=${d.applicationId}`}
                          className="text-slate-500 underline"
                        >
                          Application
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Section>

      <footer className="border-t border-slate-200 pt-4 text-xs text-slate-500">
        <p className="font-medium text-slate-600">AI provenance</p>
        {data.provenance.length === 0 ? (
          <p className="mt-1">No evaluations in view yet.</p>
        ) : (
          <p className="mt-1">
            Models in this org&apos;s evaluations:{" "}
            {data.provenance.map((p) => `${p.model} (${p.count})`).join(" · ")}
          </p>
        )}
      </footer>
    </div>
  );
}
