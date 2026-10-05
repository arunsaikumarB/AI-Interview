import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { RecruitingSubnav } from "@/components/recruiting-subnav";
import { ResumeBulkUpload } from "@/components/resume-bulk-upload";
import { UPLOAD_ROLES } from "@/lib/resume-upload/constants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Upload resumes",
};

export default async function UploadResumesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!UPLOAD_ROLES.includes(session.role) || !session.organizationId) redirect("/dashboard/candidates");

  const jobs = await prisma.job.findMany({
    where: { organizationId: session.organizationId, status: "OPEN" },
    select: { id: true, title: true, status: true },
    orderBy: { title: "asc" },
  });

  return (
    <div className="space-y-6">
      <RecruitingSubnav />
      <div>
        <Link
          href="/dashboard/candidates"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Candidates
        </Link>
        <h1 className="page-title mt-2">Upload resumes</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Select resume files. HireOS reads the name, email, phone and experience from each one so
          you can check them before saving. With a job opening chosen, each person goes into hiring
          for that opening and appears in Candidates. Without one, they go to the Talent Pool only,
          where you can Add to Hiring later. An email already in HireOS is never duplicated or changed.
        </p>
      </div>
      <section className="glass-card rounded-[var(--radius-card)] p-5">
        <ResumeBulkUpload jobs={jobs} />
      </section>
    </div>
  );
}
