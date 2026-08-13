"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Tag = { id: string; name: string; color: string | null };

export function CandidateTags({ candidateId }: { candidateId: string }) {
  const [assigned, setAssigned] = useState<Tag[]>([]);
  const [all, setAll] = useState<Tag[]>([]);
  const [pick, setPick] = useState("");

  const reload = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/candidates/${candidateId}/tags`).then((r) => r.json()),
      fetch("/api/tags").then((r) => r.json()),
    ]);
    setAssigned(a.tags ?? []);
    setAll(
      (b.tags ?? []).map((t: Tag & { candidateCount?: number }) => ({
        id: t.id,
        name: t.name,
        color: t.color,
      })),
    );
  }, [candidateId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function add() {
    if (!pick) return;
    await fetch(`/api/candidates/${candidateId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: pick }),
    });
    setPick("");
    await reload();
  }

  async function remove(tagId: string) {
    await fetch(`/api/candidates/${candidateId}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId }),
    });
    await reload();
  }

  const available = all.filter((t) => !assigned.some((a) => a.id === t.id));

  return (
    <div className="space-y-1.5">
      <p className="text-[12px] text-muted-foreground">Tags</p>
      <div className="flex flex-wrap items-center gap-1">
        {assigned.length === 0 ? (
          <span className="text-[13px] text-muted-foreground">No tags yet.</span>
        ) : (
          assigned.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void remove(t.id)}
              aria-label={`Remove tag ${t.name}`}
            >
              <Badge className="bg-muted text-foreground">{t.name} ×</Badge>
            </button>
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          className="h-7 rounded-lg border border-border bg-background px-2 text-[13px]"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          aria-label="Add tag"
        >
          <option value="">Add tag…</option>
          {available.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" onClick={() => void add()}>
          Add
        </Button>
      </div>
    </div>
  );
}
