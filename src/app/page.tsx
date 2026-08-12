import Link from "next/link";

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0f1c2e] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(94,156,186,0.35),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(214,168,106,0.22),transparent_35%),linear-gradient(180deg,#0f1c2e_0%,#15263b_55%,#1a2f45_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:48px_48px]" />

      <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <p className="font-[family-name:var(--font-display)] text-5xl leading-none tracking-tight text-white md:text-7xl">
          AI Recruitment OS
        </p>
        <h1 className="mt-6 max-w-2xl text-xl text-slate-200 md:text-2xl">
          Self-hosted ATS with AI screening, adaptive interviews, and proctoring signals —
          recruiters always decide.
        </h1>
        <p className="mt-4 max-w-xl text-sm text-slate-400">
          Runs on your stack: Next.js, PostgreSQL + pgvector, local disk storage, and Ollama at
          localhost:11434. No cloud AI. No cloud DB.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-lg bg-[#d6a86a] px-4 text-sm font-medium text-slate-950 transition hover:bg-[#e0b87f]"
          >
            Sign in
          </Link>
          <Link
            href="/careers"
            className="inline-flex h-10 items-center rounded-lg border border-white/20 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10"
          >
            View careers
          </Link>
        </div>
      </main>
    </div>
  );
}
