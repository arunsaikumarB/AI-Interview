import { PortalApplications } from "@/components/portal-applications";

export default function PortalApplicationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-slate-900">My applications</h1>
        <p className="mt-2 text-sm text-slate-500">
          Status labels are high-level only — detailed evaluations stay with recruiters.
        </p>
      </div>
      <PortalApplications />
    </div>
  );
}
