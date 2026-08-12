import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAdministerUsers } from "@/lib/auth/rbac";
import { AdminConsole } from "@/components/admin-console";
import { SettingsSubnav } from "@/components/settings-subnav";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || !canAdministerUsers(session.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <SettingsSubnav showUsers />
      <div>
        <h1 className="font-display text-3xl text-slate-900">Admin</h1>
        <p className="mt-2 text-sm text-slate-500">
          Users, departments, and organization settings. Recruiters cannot access this area.
        </p>
      </div>
      <AdminConsole actorRole={session.role} />
    </div>
  );
}
