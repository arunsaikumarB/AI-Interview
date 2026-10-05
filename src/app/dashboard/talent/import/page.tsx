import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { ResumeParserImport } from "@/components/resume-parser-import";
import { ResumeParserResumes } from "@/components/resume-parser-resumes";
import { IMPORT_ROLES, RESUME_PARSER_LABEL } from "@/lib/resume-parser-import/constants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Import from ${RESUME_PARSER_LABEL}`,
};

/** Temporary bridge until the Resume Parser API is connected. */
export default async function ResumeParserImportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!IMPORT_ROLES.includes(session.role) || !session.organizationId) redirect("/dashboard/talent");

  const section = "glass-card space-y-4 rounded-[var(--radius-card)] p-5";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/talent" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          ← Talent Pool
        </Link>
        <h1 className="page-title mt-2">Import from {RESUME_PARSER_LABEL}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Temporary until the {RESUME_PARSER_LABEL} API is connected. Step 1: upload the CSV export of
          past applications. Step 2: attach the resume files named in it. Everyone imported goes to the
          Talent Pool with their past role and date kept as history; nobody enters hiring and no AI runs.
          To consider someone for a current opening, use Add to Hiring. Existing profiles are not
          changed, and uploading the same files again does not create duplicates.
        </p>
      </div>
      <section className={section} aria-labelledby="rp-step-csv">
        <h2 id="rp-step-csv" className="text-[17px] font-semibold text-foreground">
          Step 1 · Applications (CSV)
        </h2>
        <ResumeParserImport />
      </section>
      <section className={section} aria-labelledby="rp-step-resumes">
        <h2 id="rp-step-resumes" className="text-[17px] font-semibold text-foreground">
          Step 2 · Resume files (PDF)
        </h2>
        <ResumeParserResumes />
      </section>
    </div>
  );
}
