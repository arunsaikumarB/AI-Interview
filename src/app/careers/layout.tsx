import Link from "next/link";
import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand-logo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Careers",
};

export default function CareersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-canvas min-h-screen">
      <header className="glass-topbar border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/careers" className="inline-flex max-w-[220px] items-center">
            <BrandLogo size="nav" />
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
      <footer className="mx-auto flex max-w-3xl justify-center px-4 pb-8">
        <BrandLogo size="nav" />
      </footer>
    </div>
  );
}
