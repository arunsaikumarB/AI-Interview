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
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-medium text-slate-900">Tags</h2>
      <div className="flex flex-wrap gap-1">
        {assigned.length === 0 ? (
          <p className="text-sm text-slate-500">No tags yet.</p>
        ) : (
          assigned.map((t) => (
            <button key={t.id} type="button" onClick={() => void remove(t.id)}>
              <Badge className="bg-slate-900 text-white">
                {t.name} ×
              </Badge>
            </button>
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
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
    </section>
  );
}
