import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CloudAiBanner } from "@/components/cloud-ai-banner";
import { DatabaseOfflineBanner } from "@/components/database-offline-banner";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere } from "@/lib/auth/rbac";
import { STAFF_ROLES } from "@/lib/constants";
import { getAIProvider } from "@/lib/ai/ollama";
import { prisma } from "@/lib/db";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!STAFF_ROLES.includes(session.role)) redirect("/portal");

  const cloudAi = getAIProvider() === "cloud";
  const scope = orgScopeWhere(session);
  let orgLabel = "AI Recruitment OS";
  try {
    const org = scope.organizationId
      ? await prisma.organization.findUnique({
          where: { id: scope.organizationId },
          select: { name: true, companyName: true },
        })
      : await prisma.organization.findFirst({
          select: { name: true, companyName: true },
        });
    if (org) {
      orgLabel = org.companyName?.trim() || org.name;
    }
  } catch {
    // Banner covers DB offline; keep default label
  }

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
