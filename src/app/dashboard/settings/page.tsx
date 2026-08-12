import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAdministerUsers, canManagePipeline } from "@/lib/auth/rbac";

export default async function SettingsIndexPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (canManagePipeline(session.role)) {
    redirect("/dashboard/settings/templates");
  }
  if (canAdministerUsers(session.role)) {
    redirect("/dashboard/admin");
  }
  redirect("/dashboard");
}
