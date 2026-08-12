import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAdministerUsers, canManagePipeline } from "@/lib/auth/rbac";
import { TemplatesSettings } from "@/components/templates-settings";
import { SettingsSubnav } from "@/components/settings-subnav";
import { getMailMode } from "@/lib/mail";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManagePipeline(session.role)) redirect("/dashboard");

  const mode = getMailMode();

  return (
    <div className="space-y-6">
      <SettingsSubnav showUsers={canAdministerUsers(session.role)} />
      <div>
        <h1 className="font-display text-3xl text-slate-900">
          Email templates
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Org-scoped templates. Nothing sends automatically — every send is an
          explicit recruiter action.
        </p>
        <div className="mt-2">
          <Badge
            className={
              mode === "smtp"
                ? "bg-emerald-100 text-emerald-900"
                : "bg-amber-100 text-amber-950"
            }
          >
            Mail mode: {mode}
          </Badge>
        </div>
      </div>
      <TemplatesSettings />
    </div>
  );
}
