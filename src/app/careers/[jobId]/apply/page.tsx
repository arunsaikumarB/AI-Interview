import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CareersApplyForm } from "@/components/careers-apply-form";

export const dynamic = "force-dynamic";

type Props = {
  params: { jobId: string };
  searchParams: { done?: string; already?: string; account?: string };
};

export default async function CareersApplyPage({ params, searchParams }: Props) {
  const job = await prisma.job.findFirst({
    where: { id: params.jobId, status: "OPEN" },
    select: {
      id: true,
      title: true,
      organization: { select: { name: true } },
    },
  });
  if (!job) notFound();

  if (searchParams.already === "1") {
    return (
      <div className="space-y-4 rounded-xl border border-warning/30 bg-warning/10 p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Already applied</h1>
        <p className="text-sm text-foreground/90">
          You (or someone using this email) have already applied for{" "}
          <strong>{job.title}</strong>. Our team will be in touch if there is an
          update.
        </p>
        <Link href="/careers" className="text-sm text-foreground underline">
          Back to open roles
        </Link>
      </div>
    );
  }

  if (searchParams.done === "1") {
    return (
      <div className="space-y-4 rounded-xl border border-success/30 bg-success/10 p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Application received</h1>
        <p className="text-sm text-foreground/90">
          Thanks for applying to <strong>{job.title}</strong> at{" "}
          {job.organization.name}. We&apos;ll review your resume shortly.
        </p>
        {searchParams.account === "1" ? (
          <p className="text-sm text-foreground/90">
            Your portal account is ready —{" "}
            <Link href="/login" className="underline">
              sign in
            </Link>{" "}
            to track your application.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Want to track status later? You can create an account next time you
            apply, or{" "}
            <Link href="/register" className="underline">
              register here
            </Link>
            .
          </p>
        )}
        <Link href="/careers" className="text-sm text-foreground underline">
          Back to open roles
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">{job.organization.name}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Apply — {job.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No account required. Optional portal login if you set a password below.
        </p>
      </div>
      <CareersApplyForm jobId={job.id} jobTitle={job.title} />
    </div>
  );
}
