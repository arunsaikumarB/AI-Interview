import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { PortalProfileForm } from "@/components/portal-profile-form";

export const dynamic = "force-dynamic";

export default async function PortalProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const candidate = await prisma.candidate.findUnique({
    where: { userId: session.id },
  });

  if (!candidate) {
    return (
      <div className="space-y-2">
        <h1 className="font-display text-3xl text-slate-900">Profile</h1>
        <p className="text-sm text-slate-500">
          No candidate profile linked to this account yet. Apply via careers to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-slate-900">Profile & resume</h1>
        <p className="mt-2 text-sm text-slate-500">
          {candidate.firstName} {candidate.lastName} · {candidate.email}
        </p>
      </div>
      <PortalProfileForm
        initial={{
          phone: candidate.phone ?? "",
          location: candidate.location ?? "",
          summary: candidate.summary ?? "",
          hasResume: Boolean(candidate.resumeUrl),
          resumeTextLength: candidate.resumeText?.length ?? 0,
        }}
      />
    </div>
  );
}
