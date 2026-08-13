import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canManagePipeline } from "@/lib/auth/rbac";
import { TalentSearch } from "@/components/talent-search";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Talent Pool",
};

export default async function TalentPoolPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManagePipeline(session.role)) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Talent pool</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Hybrid search: local embeddings (nomic-embed-text) plus structured
          filters for skills, experience, scores, and tags. AI suggestions are
          advisory — you decide.
        </p>
      </div>
      <TalentSearch />
    </div>
  );
}
