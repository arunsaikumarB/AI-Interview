import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { RecruitingSubnav } from "@/components/recruiting-subnav";
import { ResumeParserImport } from "@/components/resume-parser-import";
import { IMPORT_ROLES, RESUME_PARSER_LABEL } from "@/lib/resume-parser-import/constants";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Import from ${RESUME_PARSER_LABEL}`,
};

export default async function ResumeParserImportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!IMPORT_ROLES.includes(session.role)) redirect("/dashboard/candidates");

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
        <h1 className="page-title mt-2">Import from {RESUME_PARSER_LABEL}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Upload the CSV export of past applications. Choose which column holds each
          field, check the result, then import. Imported applications are marked{" "}
          {RESUME_PARSER_LABEL}, start at Applied and On hold, and appear in Candidates.
          Existing candidate profiles are not changed. Uploading the same file again
          does not create duplicates.
        </p>
      </div>
      <ResumeParserImport />
    </div>
  );
}
