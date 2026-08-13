import { PortalApplications } from "@/components/portal-applications";

export default function PortalApplicationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">My applications</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Status labels are high-level only — detailed evaluations stay with recruiters.
        </p>
      </div>
      <PortalApplications />
    </div>
  );
}
