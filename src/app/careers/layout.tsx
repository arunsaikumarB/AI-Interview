import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { PRODUCT_NAME } from "@/lib/branding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Careers",
};

export default async function CareersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { name: true, companyName: true },
  });
  const employer = org?.companyName?.trim() || org?.name || "Careers";

  return (
    <div className="app-canvas min-h-screen">
      <header className="glass-topbar border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/careers" className="font-sans text-xl font-semibold text-foreground">
            {employer}
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-center text-[11px] text-muted-foreground">
        {PRODUCT_NAME}
      </footer>
    </div>
  );
}
