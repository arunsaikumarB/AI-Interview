"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "candidates", label: "Candidates" },
  { id: "pipeline", label: "Pipeline" },
  { id: "details", label: "Job Details" },
] as const;

export type JobWorkspaceTab = (typeof TABS)[number]["id"];

export function JobWorkspaceTabs({
  jobId,
  active,
}: {
  jobId: string;
  active: JobWorkspaceTab;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-3">
      {TABS.map((tab) => {
        const href =
          tab.id === "candidates"
            ? `/dashboard/jobs/${jobId}`
            : `/dashboard/jobs/${jobId}?tab=${tab.id}`;
        const isActive = active === tab.id;
        return (
          <Link
            key={tab.id}
            href={href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
