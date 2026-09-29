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
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Shield,
} from "lucide-react";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/ui-prefs";
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
  collapsed = false,
}: {
  title?: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {title ? (
        collapsed ? (
          <div className="mx-2.5 mb-2 mt-4 border-t border-border" aria-hidden />
        ) : (
          <p className="px-2.5 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {title}
          </p>
        )
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
            title={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-2.5 rounded-[12px] py-2 text-[13px] font-medium transition-colors duration-ui",
              collapsed ? "justify-center px-0" : "px-2.5",
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
            <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
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
  collapsed = false,
  onToggleCollapsed,
}: {
  user: { name: string; email: string; role: Role };
  orgLabel: string;
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const router = useRouter();
  const isCandidate = user.role === "CANDIDATE";
  const { general, recruitment, tools } = staffNavForRole(user.role);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <>
      <div
        className={cn(
          "mb-5 flex items-center gap-2",
          collapsed ? "justify-center" : "px-2.5",
        )}
      >
        {collapsed ? null : <BrandLogo size="nav" className="min-w-0 flex-1" />}
        {onToggleCollapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="shrink-0"
          >
            <ToggleIcon className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden">
        {isCandidate ? (
          <NavSection
            items={candidateNav}
            pathname={pathname}
            onNavigate={onNavigate}
            collapsed={collapsed}
          />
        ) : (
          <>
            <NavSection
              title="General"
              items={general}
              pathname={pathname}
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
            <NavSection
              title="Recruitment"
              items={recruitment}
              pathname={pathname}
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
            <NavSection
              title="Tools"
              items={tools}
              pathname={pathname}
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
          </>
        )}
      </nav>

      <div className="mt-4 border-t border-border pt-4">
        <div
          className={cn(
            "mb-3 flex items-start gap-2.5",
            collapsed ? "justify-center" : "px-2",
          )}
          title={collapsed ? `${user.name} · ${ROLE_LABELS[user.role]}` : undefined}
        >
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-hover text-[11px] font-semibold text-foreground">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">
                {user.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {ROLE_LABELS[user.role]}
              </p>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          className={cn(
            "w-full gap-2 text-muted-foreground",
            collapsed ? "justify-center px-0" : "justify-start",
          )}
          onClick={logout}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut className="h-4 w-4" />
          <span className={collapsed ? "sr-only" : undefined}>Sign out</span>
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
  initialCollapsed = false,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; role: Role };
  orgLabel?: string;
  initialCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const canSearchTalent = canPipelineNav(user.role);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
      return next;
    });
  }

  return (
    <div className="app-canvas flex min-h-screen">
      <aside
        className={cn(
          "glass-sidebar sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden whitespace-nowrap border-r py-5 transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-[68px] px-2" : "w-[232px] px-3",
        )}
        data-collapsed={collapsed ? "true" : "false"}
      >
        <SidebarBody
          user={user}
          orgLabel={orgLabel}
          pathname={pathname}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
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
