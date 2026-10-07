import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline } from "@/lib/auth/rbac";
import { ResumeParserSearch } from "@/components/resume-parser-search";
import { UPLOAD_ROLES } from "@/lib/resume-upload/constants";
import { getResumeParserClient } from "@/lib/integrations/resume-parser/client";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Talent Pool",
};

export default async function TalentPoolPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManagePipeline(session.role)) redirect("/dashboard");

  const canAdd = Boolean(session.organizationId) && UPLOAD_ROLES.includes(session.role);
  const jobs =
    canAdd && session.organizationId
      ? await prisma.job.findMany({
          where: { organizationId: session.organizationId, status: "OPEN" },
          select: { id: true, title: true, skills: true, experienceMin: true, experienceMax: true },
          orderBy: { title: "asc" },
        })
      : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Talent pool</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Find people in Resume Parser and add them to a job opening with their resume.
        </p>
      </div>

      {!session.organizationId ? (
        <p className="text-sm text-muted-foreground">Your account is not assigned to an organization.</p>
      ) : !canAdd ? (
        <p className="text-sm text-muted-foreground">
          Ask a recruiter or HR admin to find profiles in Resume Parser and add them to a job.
        </p>
      ) : getResumeParserClient().configured ? (
        <ResumeParserSearch jobs={jobs} />
      ) : (
        <section className="space-y-1" aria-labelledby="resume-parser-heading">
          <h2 id="resume-parser-heading" className="text-[17px] font-semibold text-foreground">
            Find profiles in Resume Parser
          </h2>
          <p className="text-[13px] text-muted-foreground">Resume Parser is not connected yet. Ask your administrator.</p>
        </section>
      )}
    </div>
  );
}
