import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";
import { candidateAccountsEnabled } from "@/lib/auth/candidate-accounts";
import { resolveOrgLabel } from "@/lib/org-display";
import { readSidebarCollapsed } from "@/lib/ui-prefs-server";

export const metadata: Metadata = {
  title: "Candidate Portal",
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "CANDIDATE") redirect("/dashboard");
  if (!candidateAccountsEnabled()) redirect("/login");

  const orgLabel = await resolveOrgLabel(session.organizationId);

  return (
    <AppShell user={session} orgLabel={orgLabel} initialCollapsed={readSidebarCollapsed()}>
      {children}
    </AppShell>
  );
}
