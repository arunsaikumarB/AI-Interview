import Link from "next/link";
import { redirect } from "next/navigation";
import { JobForm } from "@/components/job-form";
import { getSession } from "@/lib/auth/session";
import { canManageJobs } from "@/lib/auth/rbac";

export default async function NewJobPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageJobs(session.role)) redirect("/dashboard/jobs");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/jobs"
          className="text-sm text-slate-500 hover:underline"
        >
          ← Jobs &amp; Candidates
        </Link>
        <h1 className="mt-2 font-display text-3xl text-slate-900">Create Job</h1>
        <p className="mt-2 text-sm text-slate-500">
          Add an open role. AI tools stay optional — you control every hiring step.
        </p>
      </div>
      <JobForm />
    </div>
  );
}
