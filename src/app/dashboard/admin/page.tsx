import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAdministerUsers } from "@/lib/auth/rbac";
import { AdminConsole } from "@/components/admin-console";
import { SettingsSubnav } from "@/components/settings-subnav";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function AdminPage() {
  const session = await getSession();
  if (!session || !canAdministerUsers(session.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <SettingsSubnav showUsers />
      <div>
        <h1 className="page-title">Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Users, departments, and organization settings. Recruiters cannot access this area.
        </p>
      </div>
      <AdminConsole actorRole={session.role} />
    </div>
  );
}
