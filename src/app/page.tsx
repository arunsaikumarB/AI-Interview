import Link from "next/link";
import { DEFAULT_COMPANY_NAME, PRODUCT_NAME, TAGLINE } from "@/lib/branding";

export default function HomePage() {
  return (
    <div className="app-canvas relative min-h-screen overflow-hidden text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-30" />

      <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <div className="accent-rule mb-6" />
        <p className="font-sans text-5xl font-semibold leading-none tracking-tight text-foreground md:text-6xl">
          {DEFAULT_COMPANY_NAME}
        </p>
        <h1 className="mt-6 max-w-2xl text-xl text-muted-foreground md:text-2xl">
          {PRODUCT_NAME}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{TAGLINE}</p>
        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
          Runs on your stack: Next.js, PostgreSQL + pgvector, local disk storage,
          and Ollama at localhost:11434. No cloud AI. No cloud DB.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
          >
            Sign in
          </Link>
          <Link
            href="/careers"
            className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            View careers
          </Link>
        </div>
      </main>
    </div>
  );
}
