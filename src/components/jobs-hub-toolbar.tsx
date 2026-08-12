"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";

export function JobsHubToolbar() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    startTransition(() => {
      router.push(`/dashboard/jobs?${sp.toString()}`);
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${pending ? "opacity-70" : ""}`}
    >
      <Input
        key={params.get("q") ?? ""}
        defaultValue={params.get("q") ?? ""}
        placeholder="Search jobs…"
        className="max-w-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            update({ q: (e.target as HTMLInputElement).value.trim() });
          }
        }}
      />
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={params.get("status") ?? "all"}
        onChange={(e) => update({ status: e.target.value })}
      >
        <option value="all">All statuses</option>
        <option value="OPEN">Open</option>
        <option value="DRAFT">Draft</option>
        <option value="PAUSED">Paused</option>
        <option value="CLOSED">Closed</option>
      </select>
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={params.get("sort") ?? "updated"}
        onChange={(e) => update({ sort: e.target.value })}
      >
        <option value="updated">Sort: Updated</option>
        <option value="title">Sort: Title</option>
        <option value="applications">Sort: Applications</option>
      </select>
    </div>
  );
}
