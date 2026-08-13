"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/** Legacy panel — prefer /dashboard/interview-links. */
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
    toast.success("Link copied.");
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">Interviews</h2>
        <Link
          href={`/dashboard/interview-links?create=1&applicationId=${applicationId}`}
          className="inline-flex h-9 items-center rounded-lg bg-primary/15 px-3 text-sm text-foreground hover:bg-muted"
        >
          Create Interview Link
        </Link>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <div>
              <p className="font-medium text-foreground">
                {r.mode ?? r.deliveryMode ?? "TEXT"} · {r.interviewType} · max{" "}
                {r.maxQuestions}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(r.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{r.status}</Badge>
              <Button size="sm" variant="outline" onClick={() => copyLink(r.accessToken)}>
                Copy link
              </Button>
              <Link
                href={`/dashboard/interviews/${r.id}`}
                className="inline-flex h-7 items-center rounded-lg px-2 text-sm text-foreground/90 hover:bg-muted"
              >
                Report
              </Link>
            </div>
          </li>
        ))}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No interviews yet.</p>
        ) : null}
      </ul>
    </section>
  );
}
