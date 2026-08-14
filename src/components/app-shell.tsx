"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandLogo } from "@/components/brand-logo";
import { DEFAULT_COMPANY_NAME } from "@/lib/branding";

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
  general: NavItem[];
  recruitment: NavItem[];
  tools: NavItem[];
} {
  const pipeline = canPipelineNav(role);
  const admin = canAdminNav(role);

  const general: NavItem[] = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      match: (p) => p === "/dashboard",
    },
  ];

  const recruitment: NavItem[] = [
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

  return { general, recruitment, tools };
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
    <div className="space-y-0.5">
      {title ? (
        <p className="px-2.5 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
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
              "group flex items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-[13px] font-medium transition-colors duration-ui",
              active
                ? "nav-active"
                : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0 transition-colors duration-ui",
                active
                  ? "nav-active-icon"
                  : "text-muted-foreground group-hover:text-foreground/80",
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

function SidebarBody({
  user,
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
  const { general, recruitment, tools } = staffNavForRole(user.role);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <div className="mb-5 px-2.5">
        <BrandLogo size="nav" />
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {isCandidate ? (
          <NavSection
            items={candidateNav}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ) : (
          <>
            <NavSection
              title="General"
              items={general}
              pathname={pathname}
              onNavigate={onNavigate}
            />
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

      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-3 flex items-start gap-2.5 px-2">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-hover text-[11px] font-semibold text-foreground">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">
              {user.name}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={logout}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </>
  );
}

function TopSearch({
  canSearchTalent,
}: {
  canSearchTalent: boolean;
}) {
  const router = useRouter();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSearchTalent) return;
    const q = new FormData(e.currentTarget).get("q");
    const value = typeof q === "string" ? q.trim() : "";
    router.push(
      value
        ? `/dashboard/talent?q=${encodeURIComponent(value)}`
        : "/dashboard/talent",
    );
  }

  return (
    <form onSubmit={onSubmit} className="relative mx-auto w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        name="q"
        type="search"
        placeholder={canSearchTalent ? "Search talent…" : "Search"}
        disabled={!canSearchTalent}
        className="topbar-search pl-9"
        aria-label="Search"
      />
    </form>
  );
}

export function AppShell({
  children,
  user,
  orgLabel = DEFAULT_COMPANY_NAME,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role: Role };
  orgLabel?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const canSearchTalent = canPipelineNav(user.role);

  return (
    <div className="app-canvas flex min-h-screen">
      <aside className="glass-sidebar hidden w-[232px] shrink-0 flex-col border-r px-3 py-5 md:flex">
        <SidebarBody user={user} orgLabel={orgLabel} pathname={pathname} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-topbar flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Open menu"
                  />
                }
              >
                <Menu className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent
                side="left"
                className="glass-sidebar w-64 border-border p-4"
              >
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
          </div>

          <div className="hidden min-w-0 flex-1 md:block">
            <TopSearch canSearchTalent={canSearchTalent} />
          </div>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <ThemeToggle />
            <div className="glass-control hidden items-center gap-2 rounded-full border py-1 pl-1 pr-3 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-hover text-[11px] font-semibold text-foreground">
                {user.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="max-w-[140px] truncate text-[12px] font-medium leading-tight text-foreground">
                  {user.name}
                </p>
                <p className="max-w-[140px] truncate text-[11px] leading-tight text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden p-5 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
