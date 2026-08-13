import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Briefcase,
  CheckCircle2,
  Plus,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import { DashboardInterviewActivity } from "@/components/dashboard-interview-activity";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSession } from "@/lib/auth/session";
import { canManageJobs, canManagePipeline } from "@/lib/auth/rbac";
import {
  getDashboardSummary,
  type MetricValue,
} from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
};

function greetingFor(date: Date, firstName: string | undefined): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }).format(date),
  );
  const part =
    hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  if (firstName?.trim()) {
    return `Good ${part}, ${firstName.trim()}`;
  }
  return "Welcome back";
}

function MetricCard({
  label,
  metric,
  hint,
  emptyHint,
  icon: Icon,
}: {
  label: string;
  metric: MetricValue;
  hint: string;
  emptyHint: string;
  icon: typeof Users;
}) {
  if (!metric.ok) {
    return (
      <div className="rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-panel">
        <div className="flex items-center justify-between">
          <p className="label-tech">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="metric-value mt-3 text-3xl">—</p>
        <p className="mt-2 text-xs text-muted-foreground">Couldn&apos;t load</p>
      </div>
    );
  }

  const empty = metric.value === 0;
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-panel">
      <div className="flex items-center justify-between">
        <p className="label-tech">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="metric-value mt-3">{metric.value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{empty ? emptyHint : hint}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const firstName = session.name?.split(/\s+/)[0];
  const greet = greetingFor(new Date(), firstName);
  const summary = await getDashboardSummary(session);
  const canJobs = canManageJobs(session.role);
  const canPipeline = canManagePipeline(session.role);

  const isEmptyOrg =
    summary.metrics.candidates.ok &&
    summary.metrics.candidates.value === 0 &&
    summary.metrics.activeJobs.ok &&
    summary.metrics.activeJobs.value === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="mt-2 text-[15px] font-medium text-foreground">{greet}</p>
          <p className="page-subtitle">
            A concise snapshot of your recruitment pipeline.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            AI screening is advisory. Pipeline moves stay with your team.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canJobs ? (
            <Link
              href="/dashboard/jobs/new"
              className={buttonVariants({ variant: "default" })}
            >
              <Plus className="h-4 w-4" />
              Add Job
            </Link>
          ) : null}
          {canPipeline ? (
            <Link
              href="/dashboard/interview-links"
              className={buttonVariants({ variant: "outline" })}
            >
              <Plus className="h-4 w-4" />
              Create Interview Link
            </Link>
          ) : null}
        </div>
      </div>

      {isEmptyOrg ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-card px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No candidates yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start by creating a job and adding your first candidate.
          </p>
          {canJobs ? (
            <Link
              href="/dashboard/jobs/new"
              className={cn(buttonVariants({ variant: "default" }), "mt-4")}
            >
              Add Job
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Candidates"
          metric={summary.metrics.candidates}
          hint="Total candidates"
          emptyHint="No candidates yet"
          icon={Users}
        />
        <MetricCard
          label="Active Jobs"
          metric={summary.metrics.activeJobs}
          hint="Currently hiring"
          emptyHint="No open jobs"
          icon={Briefcase}
        />
        <MetricCard
          label="Interviews"
          metric={summary.metrics.interviews}
          hint="Scheduled / in progress"
          emptyHint="No interviews yet"
          icon={Video}
        />
        <MetricCard
          label="Selected"
          metric={summary.metrics.selected}
          hint="Current hiring cycle"
          emptyHint="None selected yet"
          icon={CheckCircle2}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="glass-chart rounded-[var(--radius-card)] border p-5 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold text-foreground">
                Recruitment Activity
              </h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Completed vs in-progress interviews
              </p>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-chart-primary" />
                Completed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-chart-secondary" />
                In progress
              </span>
            </div>
          </div>
          {!summary.activity.ok ? (
            <p className="mt-8 text-sm text-muted-foreground">Couldn&apos;t load activity</p>
          ) : (
            <DashboardInterviewActivity
              completed={summary.activity.completed}
              inProgress={summary.activity.inProgress}
            />
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-panel">
          <h2 className="text-[17px] font-semibold text-foreground">Hiring snapshot</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Actions that need a recruiter
          </p>
          {!summary.attention.ok ? (
            <p className="mt-8 text-sm text-muted-foreground">Couldn&apos;t load attention items</p>
          ) : summary.attention.items.length === 0 ? (
            <div className="mt-8">
              <p className="text-sm font-medium text-foreground">
                You&apos;re all caught up.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                No immediate actions required.
              </p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {summary.attention.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3 py-3 text-sm text-foreground transition-colors hover:text-primary"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs text-muted-foreground">Open</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-panel">
        <div className="mb-4 flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 text-ai" />
          <div>
            <p className="text-[13px] font-medium text-ai">How can I help you?</p>
            <h2 className="mt-1 text-[17px] font-semibold text-foreground">
              AI Recruitment Summary
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Counts from your workspace — advisory only, not a hiring decision.
            </p>
          </div>
        </div>
        {!summary.attention.ok ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load summary</p>
        ) : summary.attention.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recruiter attention items right now.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {summary.attention.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="rounded-[16px] border border-border bg-surface-elevated px-4 py-3 text-sm text-foreground transition-colors hover:bg-surface-hover"
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-panel">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[17px] font-semibold text-foreground">
              Recent Interviews
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Scores are AI suggestions — recruiter decides
            </p>
          </div>
          {canPipeline ? (
            <Link
              href="/dashboard/interview-links"
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
            >
              View all
            </Link>
          ) : null}
        </div>

        {!summary.recent.ok ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load interviews</p>
        ) : summary.recent.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No interviews yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Interview</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.recent.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={row.href}
                      className="font-medium text-foreground hover:underline"
                    >
                      {row.candidateName || "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.roleTitle}</TableCell>
                  <TableCell className="text-muted-foreground">{row.interviewLabel}</TableCell>
                  <TableCell>
                    {row.score === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : row.score === "pending" ? (
                      <span className="text-muted-foreground">Pending</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 tabular-nums text-foreground">
                        {row.score}
                        <span
                          className="ai-chip"
                          title="AI suggestion — recruiter decides"
                        >
                          AI
                        </span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "status-pill border-border bg-muted text-muted-foreground",
                        row.statusLabel === "Awaiting Decision" &&
                          "border-warning/20 bg-warning/10 text-warning",
                        row.statusLabel === "In Progress" &&
                          "border-primary/20 bg-primary/10 text-primary",
                        row.statusLabel === "Completed" &&
                          "border-success/20 bg-success/10 text-success",
                      )}
                    >
                      {row.statusLabel}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
