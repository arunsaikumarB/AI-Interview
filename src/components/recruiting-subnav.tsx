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
    <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-3">
      {tabs.map((tab) => {
        const active =
          pathname === tab.match || pathname.startsWith(`${tab.match}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active
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
