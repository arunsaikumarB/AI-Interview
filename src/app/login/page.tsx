"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { DEFAULT_COMPANY_NAME, PRODUCT_NAME, TAGLINE } from "@/lib/branding";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Login failed");
      return;
    }
    const next =
      search.get("next") ??
      (data.user.role === "CANDIDATE" ? "/portal" : "/dashboard");
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required placeholder="recruiter@local.dev" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="app-canvas flex min-h-screen items-center justify-center px-4">
      <div className="surface-elevated w-full max-w-md p-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="accent-rule mb-4" />
            <p className="text-3xl font-semibold tracking-tight text-foreground">
              {DEFAULT_COMPANY_NAME}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{PRODUCT_NAME}</p>
            <p className="mt-2 text-sm text-muted-foreground">{TAGLINE}</p>
          </div>
          <ThemeToggle />
        </div>
        <div className="mt-8">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Candidate?{" "}
          <Link href="/register" className="text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
