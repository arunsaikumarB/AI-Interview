import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PortalHomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-slate-900">Candidate portal</h1>
        <p className="mt-2 text-sm text-slate-500">
          Track applications and join interviews. Internal scores stay with the hiring team.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/portal/applications">
          <Button>My applications</Button>
        </Link>
        <Link href="/portal/profile">
          <Button variant="outline">Profile & resume</Button>
        </Link>
        <Link href="/careers">
          <Button variant="outline">Browse open roles</Button>
        </Link>
      </div>
    </div>
  );
}
