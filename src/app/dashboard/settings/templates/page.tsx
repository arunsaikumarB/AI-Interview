import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAdministerUsers, canManagePipeline } from "@/lib/auth/rbac";
import { TemplatesSettings } from "@/components/templates-settings";
import { SettingsSubnav } from "@/components/settings-subnav";
import { getMailMode } from "@/lib/mail";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function TemplatesSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManagePipeline(session.role)) redirect("/dashboard");

  const mode = getMailMode();

  return (
    <div className="space-y-6">
      <SettingsSubnav showUsers={canAdministerUsers(session.role)} />
      <div>
        <h1 className="page-title">
          Email templates
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Org-scoped templates. Nothing sends automatically — every send is an
          explicit recruiter action.
        </p>
        <div className="mt-2">
          <Badge
            className={
              mode === "smtp"
                ? "bg-success/15 text-success"
                : "bg-warning/15 text-foreground"
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
