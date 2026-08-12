import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { ResumeUpload } from "@/components/resume-upload";
import { CandidateProfileForm } from "@/components/candidate-profile-form";

export const dynamic = "force-dynamic";

export default async function CandidateProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const profile = await prisma.candidate.findUnique({
    where: { userId: session.id },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-slate-900">Profile & resume</h1>
        <p className="mt-2 text-sm text-slate-500">
          Upload a PDF/DOCX resume — text is extracted on this server only.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Resume</h2>
        <ResumeUpload />
        <p className="text-sm text-slate-600">
          {profile?.resumeText
            ? `${profile.resumeText.length} characters extracted · ${profile.resumeUrl ?? "in memory"}`
            : "No resume uploaded yet."}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Profile</h2>
        <CandidateProfileForm
          initial={{
            phone: profile?.phone ?? "",
            linkedIn: profile?.linkedIn ?? "",
            location: profile?.location ?? "",
            summary: profile?.summary ?? "",
            skills: (profile?.skills ?? []).join(", "),
          }}
        />
      </section>
    </div>
  );
}
