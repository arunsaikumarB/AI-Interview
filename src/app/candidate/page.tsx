import Link from "next/link";
import { getSession } from "@/lib/auth/session";

export default async function CandidateHomePage() {
  const session = await getSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">
          Welcome{session ? `, ${session.name}` : ""}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Browse open roles and track your applications. Interview proctoring records signals only —
          humans review outcomes.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/candidate/jobs"
          className="rounded-lg bg-primary/15 px-4 py-2 text-sm text-foreground"
        >
          Browse jobs
        </Link>
        <Link
          href="/candidate/applications"
          className="rounded-lg border border-border px-4 py-2 text-sm text-foreground/90"
        >
          My applications
        </Link>
      </div>
    </div>
  );
}
