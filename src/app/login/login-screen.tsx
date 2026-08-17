"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandLogo } from "@/components/brand-logo";

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
    <form onSubmit={onSubmit} className="w-full space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email" className="text-[13px] font-semibold">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="recruiter@local.dev"
          className="h-11 text-[15px] md:text-[15px]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="text-[13px] font-semibold">
          Password
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          className="h-11 text-[15px] md:text-[15px]"
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="pt-1">
        <Button
          type="submit"
          className="h-12 w-full text-[15px] font-semibold"
          disabled={loading}
        >
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </div>
    </form>
  );
}

export default function LoginScreen() {
  return (
    <div className="app-canvas relative grid min-h-svh place-items-center overflow-x-hidden px-6 py-6">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <div className="flex justify-center">
          <BrandLogo size="auth" />
        </div>
        <div className="mt-8 w-full">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Candidate?{" "}
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
