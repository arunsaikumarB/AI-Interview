import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CloudAiBanner } from "@/components/cloud-ai-banner";
import { DatabaseOfflineBanner } from "@/components/database-offline-banner";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere } from "@/lib/auth/rbac";
import { STAFF_ROLES } from "@/lib/constants";
import { getAIProvider } from "@/lib/ai/ollama";
import { resolveOrgLabel } from "@/lib/org-display";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!STAFF_ROLES.includes(session.role)) redirect("/portal");

  const cloudAi = getAIProvider() === "cloud";
  const scope = orgScopeWhere(session);
  const orgLabel = await resolveOrgLabel(scope.organizationId);

  return (
    <>
      <DatabaseOfflineBanner />
      {cloudAi ? <CloudAiBanner /> : null}
      <AppShell user={session} orgLabel={orgLabel}>
        {children}
      </AppShell>
    </>
  );
}
