import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { PRODUCT_NAME, TAGLINE } from "@/lib/branding";

export default function HomePage() {
  return (
    <div className="app-canvas relative min-h-svh overflow-x-hidden text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-30" />
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <main className="relative grid min-h-svh place-items-center px-6 py-16">
        <div className="hero-content flex flex-col items-center text-center">
          <h1 className="sr-only">{PRODUCT_NAME}</h1>
          <BrandLogo size="hero" />
          <p className="mt-6 max-w-md text-base leading-relaxed text-foreground/75 sm:text-lg">
            {TAGLINE}
          </p>
          <div className="mt-10 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              href="/login"
              className="btn-primary inline-flex h-12 min-w-[10.5rem] items-center justify-center rounded-[14px] px-8 text-[15px] font-semibold text-white transition hover:opacity-95"
            >
              Sign in
            </Link>
            <Link
              href="/careers"
              className="inline-flex h-12 min-w-[10.5rem] items-center justify-center rounded-[14px] border border-border bg-surface/80 px-8 text-[15px] font-semibold text-foreground transition hover:bg-muted"
            >
              View careers
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
