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
      <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="font-display text-2xl text-slate-900">Already applied</h1>
        <p className="text-sm text-slate-700">
          You (or someone using this email) have already applied for{" "}
          <strong>{job.title}</strong>. Our team will be in touch if there is an
          update.
        </p>
        <Link href="/careers" className="text-sm text-slate-900 underline">
          Back to open roles
        </Link>
      </div>
    );
  }

  if (searchParams.done === "1") {
    return (
      <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h1 className="font-display text-2xl text-slate-900">Application received</h1>
        <p className="text-sm text-slate-700">
          Thanks for applying to <strong>{job.title}</strong> at{" "}
          {job.organization.name}. We&apos;ll review your resume shortly.
        </p>
        {searchParams.account === "1" ? (
          <p className="text-sm text-slate-700">
            Your portal account is ready —{" "}
            <Link href="/login" className="underline">
              sign in
            </Link>{" "}
            to track your application.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Want to track status later? You can create an account next time you
            apply, or{" "}
            <Link href="/register" className="underline">
              register here
            </Link>
            .
          </p>
        )}
        <Link href="/careers" className="text-sm text-slate-900 underline">
          Back to open roles
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">{job.organization.name}</p>
        <h1 className="font-display text-3xl text-slate-900">
          Apply — {job.title}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          No account required. Optional portal login if you set a password below.
        </p>
      </div>
      <CareersApplyForm jobId={job.id} jobTitle={job.title} />
    </div>
  );
}
