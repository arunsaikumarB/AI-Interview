"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

type LogRow = {
  id: string;
  status: string;
  subject: string | null;
  body: string | null;
  createdAt: string;
  sentAt: string | null;
  toAddress: string;
};

export function CommunicationHistory({ candidateId }: { candidateId: string }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
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

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-slate-900">Communication</h2>
      {logs.length === 0 ? (
        <p className="text-sm text-slate-500">No emails logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {logs.map((l) => (
            <li
              key={l.id}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 text-left"
                onClick={() => setOpenId((id) => (id === l.id ? null : l.id))}
              >
                <Badge
                  className={
                    l.status === "SENT"
                      ? "bg-emerald-100 text-emerald-900"
                      : l.status === "FAILED"
                        ? "bg-rose-100 text-rose-900"
                        : "bg-amber-100 text-amber-950"
                  }
                >
                  {l.status}
                </Badge>
                <span className="font-medium text-slate-900">
                  {l.subject ?? "(no subject)"}
                </span>
                <span className="text-xs text-slate-400">
                  {formatDateTime(l.sentAt ?? l.createdAt)}
                </span>
              </button>
              {openId === l.id ? (
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  {l.body}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
