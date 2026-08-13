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
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-muted p-1">
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
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
