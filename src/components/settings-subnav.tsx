"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsSubnav({
  showUsers,
}: {
  showUsers: boolean;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: "/dashboard/settings/templates", label: "Templates", show: true },
    { href: "/dashboard/admin", label: "Users", show: showUsers },
  ].filter((t) => t.show);

  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-3">
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
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
