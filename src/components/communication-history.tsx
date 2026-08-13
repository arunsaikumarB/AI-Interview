"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

export type CommunicationLogRow = {
  id: string;
  status: string;
  subject: string | null;
  body: string | null;
  createdAt: string;
  sentAt: string | null;
  toAddress: string;
};

export function CommunicationHistory({
  candidateId,
  initialLogs,
}: {
  candidateId: string;
  initialLogs?: CommunicationLogRow[];
}) {
  const [logs, setLogs] = useState<CommunicationLogRow[]>(initialLogs ?? []);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/communications?candidateId=${encodeURIComponent(candidateId)}&limit=50`,
      );
      const data = await res.json();
      if (res.ok) setLogs(data.logs ?? []);
    })();
  }, [candidateId]);

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No communication yet.</p>;
  }

  const latest = logs[0];

  return (
    <div className="space-y-3">
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-[12px] text-muted-foreground">Last communication</dt>
          <dd className="font-medium text-foreground">
            {latest.subject ?? "(no subject)"}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted-foreground">Emails</dt>
          <dd className="font-medium text-foreground">{logs.length}</dd>
        </div>
      </dl>
      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-primary hover:underline">
          View communication
        </summary>
        <ul className="mt-3 space-y-1.5">
          {logs.map((l) => (
            <li key={l.id} className="text-sm">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 text-left"
                onClick={() => setOpenId((id) => (id === l.id ? null : l.id))}
              >
                <Badge
                  className={
                    l.status === "SENT"
                      ? "bg-success/15 text-success"
                      : l.status === "FAILED"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-warning/15 text-foreground"
                  }
                >
                  {l.status}
                </Badge>
                <span className="font-medium text-foreground">
                  {l.subject ?? "(no subject)"}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {formatDateTime(l.sentAt ?? l.createdAt)}
                </span>
              </button>
              {openId === l.id ? (
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs text-foreground/90">
                  {l.body}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
