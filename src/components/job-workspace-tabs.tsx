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
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-muted p-1">
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
              "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
