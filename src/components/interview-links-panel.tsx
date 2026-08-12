"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CreateInterviewDialog } from "@/components/create-interview-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";

export type InterviewLinkRow = {
  id: string;
  status: string;
  interviewType: string;
  deliveryMode: string;
  accessToken: string;
  createdAt: string;
  scheduledAt: string | null;
  candidateName: string;
  jobTitle: string;
  awaitingDecision: boolean;
};

export type ApplicationOption = {
  id: string;
  label: string;
};

export function InterviewLinksPanel({
  rows,
  applications,
  filterAwaiting,
}: {
  rows: InterviewLinkRow[];
  applications: ApplicationOption[];
  filterAwaiting?: boolean;
}) {
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? "");
  const visible = useMemo(
    () => (filterAwaiting ? rows.filter((r) => r.awaitingDecision) : rows),
    [rows, filterAwaiting],
  );

  async function copyLink(token: string) {
    const base = window.location.origin;
    await navigator.clipboard.writeText(`${base}/interview/${token}`);
    toast.success("Link copied");
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <h2 className="text-sm font-semibold text-slate-900">Create interview link</h2>
        <p className="mt-1 text-xs text-slate-500">
          Pick an application, generate a plan, then copy the candidate link. AI does not
          change pipeline stage.
        </p>
        {applications.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No active applications yet. Add a candidate to a job first.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="application">Application</Label>
              <select
                id="application"
                className="h-9 w-full max-w-xl rounded-lg border border-input bg-background px-3 text-sm"
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
              >
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            {applicationId ? (
              <CreateInterviewDialog applicationId={applicationId} />
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {filterAwaiting ? "Awaiting decision" : "Interview sessions"}
          </h2>
          {filterAwaiting ? (
            <Link
              href="/dashboard/interview-links"
              className="text-sm text-slate-600 underline-offset-2 hover:underline"
            >
              Show all
            </Link>
          ) : null}
        </div>
        <ul className="space-y-2">
          {visible.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{r.candidateName}</p>
                <p className="text-xs text-slate-500">
                  {r.jobTitle} · {r.interviewType} ·{" "}
                  {formatDateTime(r.scheduledAt ?? r.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{r.status}</Badge>
                {r.status === "SCHEDULED" ? (
                  <Link
                    href={`/dashboard/interviews/${r.id}/plan`}
                    className="inline-flex h-7 items-center rounded-lg bg-slate-900 px-2 text-sm text-white hover:bg-slate-800"
                  >
                    Review plan
                  </Link>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => copyLink(r.accessToken)}>
                  Copy link
                </Button>
                <Link
                  href={`/dashboard/interviews/${r.id}`}
                  className="inline-flex h-7 items-center rounded-lg px-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Report
                </Link>
              </div>
            </li>
          ))}
          {visible.length === 0 ? (
            <p className="text-sm text-slate-500">
              {filterAwaiting
                ? "No completed interviews awaiting a decision."
                : "No interview links yet."}
            </p>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
