"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateInterviewDialog } from "@/components/create-interview-dialog";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";

type InterviewRow = {
  id: string;
  status: string;
  interviewType: string;
  mode?: string;
  deliveryMode?: string;
  maxQuestions: number;
  accessToken: string;
  createdAt: string;
};

export function InterviewsPanel({ applicationId }: { applicationId: string }) {
  const [rows, setRows] = useState<InterviewRow[]>([]);

  async function load() {
    const res = await fetch(`/api/applications/${applicationId}/interviews`);
    const data = await res.json();
    if (res.ok) setRows(data.interviews ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  async function copyLink(token: string) {
    const base = window.location.origin;
    await navigator.clipboard.writeText(`${base}/interview/${token}`);
    toast.success("Link copied");
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-slate-900">Interviews</h2>
        <CreateInterviewDialog applicationId={applicationId} />
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <div>
              <p className="font-medium text-slate-900">
                {r.mode ?? r.deliveryMode ?? "TEXT"} · {r.interviewType} · max{" "}
                {r.maxQuestions}
              </p>
              <p className="text-xs text-slate-500">
                {formatDateTime(r.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
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
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No interviews yet.</p>
        ) : null}
      </ul>
    </section>
  );
}
