"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";
import { STAGE_LABELS } from "@/lib/constants";
import type { PipelineStage } from "@prisma/client";

export function CandidatesListToolbar() {
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
      router.push(`/dashboard/candidates?${sp.toString()}`);
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${pending ? "opacity-70" : ""}`}
    >
      <Input
        key={params.get("q") ?? ""}
        defaultValue={params.get("q") ?? ""}
        placeholder="Search candidates…"
        className="max-w-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            update({ q: (e.target as HTMLInputElement).value.trim() });
          }
        }}
      />
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={params.get("stage") ?? "all"}
        onChange={(e) => update({ stage: e.target.value })}
      >
        <option value="all">All stages</option>
        {(Object.keys(STAGE_LABELS) as PipelineStage[]).map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      <select
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        value={params.get("sort") ?? "updated"}
        onChange={(e) => update({ sort: e.target.value })}
      >
        <option value="updated">Sort: Updated</option>
        <option value="name">Sort: Name</option>
        <option value="match">Sort: AI Match</option>
      </select>
    </div>
  );
}
