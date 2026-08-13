import { redirect } from "next/navigation";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline } from "@/lib/auth/rbac";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics",
};

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session || !canManagePipeline(session.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Analytics</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Read-only org metrics — funnel, speed, scores, and AI vs recruiter agreement.
        </p>
      </div>
      <AnalyticsDashboard />
    </div>
  );
}
