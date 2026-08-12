import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
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

export const dynamic = "force-dynamic";

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
}: {
  label: string;
  metric: MetricValue;
  hint: string;
  emptyHint: string;
}) {
  if (!metric.ok) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-2 text-3xl font-semibold text-slate-300">—</p>
        <p className="mt-1 text-xs text-slate-400">Couldn&apos;t load</p>
      </div>
    );
  }

  const empty = metric.value === 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">
        {metric.value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{empty ? emptyHint : hint}</p>
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-slate-900">Dashboard</h1>
          <p className="mt-2 text-base font-medium text-slate-800">{greet}</p>
          <p className="mt-1 text-sm text-slate-500">
            Here&apos;s what&apos;s happening with your recruitment today.
          </p>
          <p className="mt-2 text-xs text-slate-500">
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
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center">
          <p className="text-sm font-medium text-slate-900">No candidates yet</p>
          <p className="mt-1 text-sm text-slate-500">
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Candidates"
          metric={summary.metrics.candidates}
          hint="Total candidates"
          emptyHint="No candidates yet"
        />
        <MetricCard
          label="Active Jobs"
          metric={summary.metrics.activeJobs}
          hint="Currently hiring"
          emptyHint="No open jobs"
        />
        <MetricCard
          label="Interviews"
          metric={summary.metrics.interviews}
          hint="Scheduled / in progress"
          emptyHint="No interviews yet"
        />
        <MetricCard
          label="Selected"
          metric={summary.metrics.selected}
          hint="Current hiring cycle"
          emptyHint="None selected yet"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">
            Interview Activity
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">Completed vs in progress</p>
          {!summary.activity.ok ? (
            <p className="mt-8 text-sm text-slate-400">Couldn&apos;t load activity</p>
          ) : (
            <DashboardInterviewActivity
              completed={summary.activity.completed}
              inProgress={summary.activity.inProgress}
            />
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Needs Attention</h2>
          <p className="mt-0.5 text-sm text-slate-500">Actions that need a recruiter</p>
          {!summary.attention.ok ? (
            <p className="mt-8 text-sm text-slate-400">Couldn&apos;t load attention items</p>
          ) : summary.attention.items.length === 0 ? (
            <div className="mt-8">
              <p className="text-sm font-medium text-slate-800">
                You&apos;re all caught up.
              </p>
              <p className="mt-1 text-sm text-slate-500">
                No immediate actions required.
              </p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {summary.attention.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3 py-3 text-sm text-slate-800 transition-colors hover:text-slate-950"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs text-slate-400">Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Recent Interviews
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Scores are AI suggestions — recruiter decides
            </p>
          </div>
          {canPipeline ? (
            <Link
              href="/dashboard/interview-links"
              className="text-sm text-slate-600 underline-offset-2 hover:underline"
            >
              View all
            </Link>
          ) : null}
        </div>

        {!summary.recent.ok ? (
          <p className="text-sm text-slate-400">Couldn&apos;t load interviews</p>
        ) : summary.recent.rows.length === 0 ? (
          <p className="text-sm text-slate-500">No interviews yet.</p>
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
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {row.candidateName || "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{row.roleTitle}</TableCell>
                  <TableCell className="text-slate-600">{row.interviewLabel}</TableCell>
                  <TableCell>
                    {row.score === null ? (
                      <span className="text-slate-400">—</span>
                    ) : row.score === "pending" ? (
                      <span className="text-slate-600">Pending</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 tabular-nums text-slate-900">
                        {row.score}
                        <span
                          className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"
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
                        "text-sm",
                        row.statusLabel === "Awaiting Decision"
                          ? "font-medium text-amber-800"
                          : "text-slate-600",
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
