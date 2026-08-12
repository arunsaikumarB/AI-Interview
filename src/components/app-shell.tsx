"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Briefcase,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Search,
  Settings,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ROLE_LABELS } from "@/lib/constants";
import type { Role } from "@prisma/client";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  match?: (pathname: string) => boolean;
};

function canPipelineNav(role: Role) {
  return (
    role === "SUPER_ADMIN" ||
    role === "HR_ADMIN" ||
    role === "RECRUITER" ||
    role === "HIRING_MANAGER"
  );
}

function canAdminNav(role: Role) {
  return role === "SUPER_ADMIN" || role === "HR_ADMIN";
}

function staffNavForRole(role: Role): {
  recruitment: NavItem[];
  tools: NavItem[];
} {
  const pipeline = canPipelineNav(role);
  const admin = canAdminNav(role);

  const recruitment: NavItem[] = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      match: (p) => p === "/dashboard",
    },
    {
      href: "/dashboard/recruiting",
      label: "Jobs & Candidates",
      icon: Briefcase,
      match: (p) =>
        p.startsWith("/dashboard/recruiting") ||
        p.startsWith("/dashboard/jobs") ||
        p.startsWith("/dashboard/candidates") ||
        p.startsWith("/dashboard/pipeline"),
    },
  ];

  if (pipeline) {
    recruitment.push({
      href: "/dashboard/interview-links",
      label: "Interview Links",
      icon: Link2,
      match: (p) =>
        p.startsWith("/dashboard/interview-links") ||
        p.startsWith("/dashboard/interviews"),
    });
    recruitment.push({
      href: "/dashboard/talent",
      label: "Talent Pool",
      icon: Search,
      match: (p) => p.startsWith("/dashboard/talent"),
    });
  }

  const tools: NavItem[] = [];
  if (pipeline) {
    tools.push({
      href: "/dashboard/analytics",
      label: "Analytics",
      icon: BarChart3,
      match: (p) => p.startsWith("/dashboard/analytics"),
    });
  }
  if (pipeline || admin) {
    tools.push({
      href: "/dashboard/settings",
      label: "Settings",
      icon: Settings,
      match: (p) =>
        p.startsWith("/dashboard/settings") || p.startsWith("/dashboard/admin"),
    });
  }

  return { recruitment, tools };
}

const candidateNav: NavItem[] = [
  { href: "/portal", label: "Home", icon: LayoutDashboard },
  { href: "/portal/applications", label: "My applications", icon: Briefcase },
  { href: "/portal/profile", label: "Profile & resume", icon: Shield },
  { href: "/careers", label: "Open roles", icon: Search },
];

function NavSection({
  title,
  items,
  pathname,
  onNavigate,
}: {
  title?: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {title ? (
        <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </p>
      ) : null}
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.match
          ? item.match(pathname)
          : pathname === item.href ||
            (item.href !== "/dashboard" &&
              item.href !== "/portal" &&
              pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-slate-900/90 text-white"
                : "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-80" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

function SidebarBody({
  user,
  orgLabel,
  pathname,
  onNavigate,
}: {
  user: { name: string; email: string; role: Role };
  orgLabel: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const isCandidate = user.role === "CANDIDATE";
  const { recruitment, tools } = staffNavForRole(user.role);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <div className="mb-6 px-1">
        <p className="font-display text-lg tracking-tight text-slate-900">
          {orgLabel}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">Recruitment</p>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {isCandidate ? (
          <NavSection items={candidateNav} pathname={pathname} onNavigate={onNavigate} />
        ) : (
          <>
            <NavSection
              title="Recruitment"
              items={recruitment}
              pathname={pathname}
              onNavigate={onNavigate}
            />
            <NavSection
              title="Tools"
              items={tools}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          </>
        )}
      </nav>

      <div className="mt-4 border-t border-slate-200/80 pt-4">
        <div className="mb-3 flex items-start gap-2 px-1">
          <Shield className="mt-0.5 h-4 w-4 text-slate-400" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={logout}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </>
  );
}

export function AppShell({
  children,
  user,
  orgLabel = "AI Recruitment OS",
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role: Role };
  orgLabel?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f6f4f0]">
      <div className="mx-auto flex min-h-screen max-w-[1400px] gap-6 px-4 py-4 md:px-6 md:py-6">
        <aside className="hidden w-56 shrink-0 flex-col rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm md:flex">
          <SidebarBody user={user} orgLabel={orgLabel} pathname={pathname} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-2 md:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="Open menu" />
                }
              >
                <Menu className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent side="left" className="w-64 bg-white p-4">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <SidebarBody
                  user={user}
                  orgLabel={orgLabel}
                  pathname={pathname}
                  onNavigate={() => setOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <p className="font-display text-base text-slate-900">{orgLabel}</p>
          </div>

          <main className="min-w-0 flex-1 rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm md:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
