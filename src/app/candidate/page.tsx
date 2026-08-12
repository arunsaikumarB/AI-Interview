import Link from "next/link";
import { getSession } from "@/lib/auth/session";

export default async function CandidateHomePage() {
  const session = await getSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-slate-900">
          Welcome{session ? `, ${session.name}` : ""}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Browse open roles and track your applications. Interview proctoring records signals only —
          humans review outcomes.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/candidate/jobs"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Browse jobs
        </Link>
        <Link
          href="/candidate/applications"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700"
        >
          My applications
        </Link>
      </div>
    </div>
  );
}
