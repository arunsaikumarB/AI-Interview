"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";

export function InterviewLinksToolbar() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    // Keep create/preselect params out of filter churn
    startTransition(() => {
      router.push(`/dashboard/interview-links?${sp.toString()}`);
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${pending ? "opacity-70" : ""}`}
    >
      <Input
        key={params.get("q") ?? ""}
        defaultValue={params.get("q") ?? ""}
        placeholder="Search candidates or jobs…"
        className="max-w-sm"
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
        <option value="Active">Active</option>
        <option value="In Progress">In Progress</option>
        <option value="Completed">Completed</option>
        <option value="Expired">Expired</option>
        <option value="Cancelled">Cancelled</option>
      </select>
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={params.get("sort") ?? "created"}
        onChange={(e) => update({ sort: e.target.value })}
      >
        <option value="created">Sort: Created</option>
        <option value="expires">Sort: Expires</option>
        <option value="candidate">Sort: Candidate</option>
        <option value="job">Sort: Job</option>
      </select>
    </div>
  );
}
