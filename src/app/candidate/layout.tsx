import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";
import { resolveOrgLabel } from "@/lib/org-display";

export const metadata: Metadata = {
  title: "Candidate Portal",
};

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "CANDIDATE" && session.role !== "SUPER_ADMIN") {
    redirect("/dashboard");
  }

  const orgLabel = await resolveOrgLabel(session.organizationId);

  return (
    <AppShell user={session} orgLabel={orgLabel}>
      {children}
    </AppShell>
  );
}
