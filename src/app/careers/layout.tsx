import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CareersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8eef7_0%,_#f7f5f1_45%,_#f3efe8_100%)]">
      <header className="border-b border-black/5 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/careers" className="font-display text-xl text-slate-900">
            {org?.name ?? "Careers"}
          </Link>
          <Link
            href="/login"
            className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}
