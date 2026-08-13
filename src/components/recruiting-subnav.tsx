"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dashboard/jobs", label: "Jobs", match: "/dashboard/jobs" },
  {
    href: "/dashboard/candidates",
    label: "Candidates",
    match: "/dashboard/candidates",
  },
  {
    href: "/dashboard/pipeline",
    label: "Pipeline",
    match: "/dashboard/pipeline",
  },
] as const;

export function RecruitingSubnav() {
  const pathname = usePathname();

  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-muted p-1">
      {tabs.map((tab) => {
        const active =
          pathname === tab.match || pathname.startsWith(`${tab.match}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
              active
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
