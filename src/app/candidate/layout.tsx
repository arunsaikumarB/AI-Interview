import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "CANDIDATE" && session.role !== "SUPER_ADMIN") {
    redirect("/dashboard");
  }

  return <AppShell user={session}>{children}</AppShell>;
}
