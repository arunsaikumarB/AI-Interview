import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline } from "@/lib/auth/rbac";
import { TalentSearch } from "@/components/talent-search";
import { TalentBrowse } from "@/components/talent-browse";
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

  const openJobs = session.organizationId
    ? await prisma.job.findMany({
        where: { organizationId: session.organizationId, status: "OPEN" },
        select: { id: true, title: true, status: true, location: true, skills: true, experienceMin: true, experienceMax: true },
        orderBy: { title: "asc" },
      })
    : [];
  const jobs = openJobs.map(({ id, title, status, location }) => ({ id, title, status, location }));
  const parserJobs = openJobs.map(({ id, title, skills, experienceMin, experienceMax }) => ({
    id,
    title,
    skills,
    experienceMin,
    experienceMax,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Talent pool</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Historical and available candidates, including Resume Parser history and resumes uploaded
          without a job. Nobody here is in hiring until you choose Add to Hiring and pick a current
          job opening.
        </p>
      </div>

      {session.organizationId && UPLOAD_ROLES.includes(session.role) ? (
        getResumeParserClient().configured ? (
          <ResumeParserSearch jobs={parserJobs} />
        ) : (
          <section className="space-y-1" aria-labelledby="resume-parser-heading">
            <h2 id="resume-parser-heading" className="text-[17px] font-semibold text-foreground">
              Find profiles in Resume Parser
            </h2>
            <p className="text-[13px] text-muted-foreground">Resume Parser is not connected yet. Ask your administrator.</p>
          </section>
        )
      ) : null}

      {session.organizationId ? (
        <TalentBrowse jobs={jobs} />
      ) : (
        <p className="text-sm text-muted-foreground">Your account is not assigned to an organization.</p>
      )}

      <section className="space-y-3" aria-labelledby="ai-search-heading">
        <div>
          <h2 id="ai-search-heading" className="text-[17px] font-semibold text-foreground">
            AI search
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Hybrid search: local embeddings (nomic-embed-text) plus structured filters for skills,
            experience, scores, and tags. AI suggestions are advisory — you decide.
          </p>
        </div>
        <TalentSearch />
      </section>
    </div>
  );
}
