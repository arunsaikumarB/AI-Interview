"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Registration failed");
      return;
    }
    router.push("/portal");
    router.refresh();
  }

  return (
    <div className="app-canvas relative grid min-h-svh place-items-center overflow-x-hidden px-6 py-6">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <div className="flex justify-center">
          <BrandLogo size="auth" />
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Candidate signup
        </p>
        <form onSubmit={onSubmit} className="mt-8 w-full space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[13px] font-semibold">
              Full name
            </Label>
            <Input id="name" name="name" required className="h-11 text-[15px] md:text-[15px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[13px] font-semibold">
              Email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
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
              minLength={8}
              required
              className="h-11 text-[15px] md:text-[15px]"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="pt-1">
            <Button type="submit" className="h-12 w-full text-[15px] font-semibold" disabled={loading}>
              {loading ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
