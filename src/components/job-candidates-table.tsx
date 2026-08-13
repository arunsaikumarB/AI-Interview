"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PipelineStage } from "@prisma/client";
import { STAGE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { Input } from "@/components/ui/input";

export type JobCandidateRow = {
  applicationId: string;
  candidateId: string;
  name: string;
  email: string;
  experience: number;
  aiMatch: number | null;
  stage: PipelineStage;
  interviewStatus: string | null;
  updatedAt: string;
};

function interviewLabel(status: string | null): string {
  if (!status) return "—";
  switch (status) {
    case "SCHEDULED":
      return "Scheduled";
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "NO_SHOW":
      return "No show";
    default:
      return status;
  }
}

export function JobCandidatesTable({ rows }: { rows: JobCandidateRow[] }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string>("all");
  const [sort, setSort] = useState<"updated" | "name" | "match">("updated");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (stage !== "all" && r.stage !== stage) return false;
      if (!query) return true;
      return (
        r.name.toLowerCase().includes(query) ||
        r.email.toLowerCase().includes(query)
      );
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "match") return (b.aiMatch ?? -1) - (a.aiMatch ?? -1);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  }, [rows, q, stage, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Candidates</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search candidates…"
          className="max-w-xs"
        />
        <select
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          <option value="all">All stages</option>
          {(Object.keys(STAGE_LABELS) as PipelineStage[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="updated">Sort: Updated</option>
          <option value="name">Sort: Name</option>
          <option value="match">Sort: AI Match</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Candidate</th>
              <th className="px-4 py-3 font-medium">Experience</th>
              <th className="px-4 py-3 font-medium">AI Match</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Interview</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.applicationId} className="border-t border-border">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/candidates/${r.candidateId}?applicationId=${r.applicationId}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {r.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{r.email}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.experience} yr{r.experience === 1 ? "" : "s"}
                </td>
                <td className="px-4 py-3">
                  {r.aiMatch == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div>
                      <span className="tabular-nums text-foreground">
                        {Math.round(r.aiMatch)}%
                      </span>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        AI Match
                      </p>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground/90">
                  {STAGE_LABELS[r.stage]}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {interviewLabel(r.interviewStatus)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(r.updatedAt)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  No candidates match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
