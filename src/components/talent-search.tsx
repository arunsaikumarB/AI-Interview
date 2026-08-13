"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  removeTalentFilterChip,
  talentFilterChips,
  type TalentQuery,
} from "@/lib/ai/talent-query";
import { cn } from "@/lib/utils";

type Hit = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  summary: string | null;
  skills: string[];
  experience: number;
  location: string | null;
  similarity: number | null;
  noEmbedding: boolean;
  screeningScore: number | null;
  interviewScore: number | null;
  tags: string[];
};

type OrgTag = { id: string; name: string; color: string | null; candidateCount: number };

export function TalentSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<TalentQuery | null>(null);
  const [results, setResults] = useState<Hit[]>([]);
  const [meta, setMeta] = useState<{ withEmbedding: number; totalCandidates: number } | null>(
    null,
  );
  const [tags, setTags] = useState<OrgTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [searched, setSearched] = useState(false);

  const loadTags = useCallback(async () => {
    const res = await fetch("/api/tags");
    const data = await res.json();
    if (res.ok) setTags(data.tags ?? []);
  }, []);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  async function runSearch(opts?: {
    filtersOverride?: TalentQuery | null;
    tagIds?: string[];
  }) {
    const q = query.trim();
    if (!q && !opts?.filtersOverride) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch("/api/talent/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q || opts?.filtersOverride?.semanticText || " ",
          limit: 20,
          ...(opts?.filtersOverride
            ? { filters: opts.filtersOverride }
            : {}),
          tagIds: opts?.tagIds ?? selectedTagIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Search failed");
        setResults([]);
        return;
      }
      setParsed(Boolean(data.parsed));
      setFilters(data.appliedFilters ?? null);
      setResults(data.results ?? []);
      setMeta(data.meta ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function removeChip(chip: { key: string; index?: number }) {
    if (!filters) return;
    const next = removeTalentFilterChip(filters, chip);
    setFilters(next);
    void runSearch({ filtersOverride: next });
  }

  async function createTag() {
    const name = newTag.trim();
    if (!name) return;
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setNewTag("");
      await loadTags();
    }
  }

  async function renameTag(id: string, name: string) {
    const next = window.prompt("Rename tag", name);
    if (!next?.trim()) return;
    await fetch(`/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next.trim() }),
    });
    await loadTags();
  }

  async function deleteTag(id: string) {
    if (!window.confirm("Delete this tag?")) return;
    await fetch(`/api/tags/${id}`, { method: "DELETE" });
    setSelectedTagIds((prev) => prev.filter((t) => t !== id));
    await loadTags();
  }

  const chips = filters ? talentFilterChips(filters) : [];
  const noEmbeddingsYet = meta != null && meta.withEmbedding === 0;

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <input
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary/50"
          placeholder='e.g. "postgres docker platform engineer" or "designers with Figma"'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" disabled={loading || !query.trim()}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </form>

      {parsed === false ? (
        <p className="text-xs text-warning">
          Query understood as semantic-only (parser fallback) — no invented filters.
        </p>
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Understood:
          </span>
          {chips.map((chip) => (
            <button
              key={`${chip.key}-${chip.index ?? chip.label}`}
              type="button"
              onClick={() => removeChip(chip)}
              className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs text-foreground"
              title="Remove filter and re-run"
            >
              {chip.label}
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card/80 p-4">
        <h2 className="text-sm font-medium text-foreground">Org tags</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Create tags, filter the pool, and assign them on candidate profiles.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((t) => {
            const on = selectedTagIds.includes(t.id);
            return (
              <div key={t.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTagIds((prev) => {
                      const next = on
                        ? prev.filter((id) => id !== t.id)
                        : [...prev, t.id];
                      if (searched && filters) {
                        void runSearch({
                          filtersOverride: filters,
                          tagIds: next,
                        });
                      }
                      return next;
                    });
                  }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs",
                    on
                      ? "bg-primary/15 text-foreground"
                      : "bg-muted text-foreground/90 hover:bg-surface-hover",
                  )}
                >
                  {t.name} · {t.candidateCount}
                </button>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground/90"
                  onClick={() => void renameTag(t.id, t.name)}
                >
                  rename
                </button>
                <button
                  type="button"
                  className="text-[10px] text-destructive hover:text-destructive"
                  onClick={() => void deleteTag(t.id)}
                >
                  del
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="rounded-lg border border-border px-2 py-1 text-sm"
            placeholder="New tag name"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => void createTag()}>
            Add tag
          </Button>
        </div>
      </section>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {noEmbeddingsYet ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          No candidate embeddings yet. Run{" "}
          <code className="rounded bg-card px-1">npm run embed:backfill</code>{" "}
          (local Ollama + nomic-embed-text) then search again.
        </div>
      ) : null}

      {searched && !loading && results.length === 0 && !noEmbeddingsYet ? (
        <p className="text-sm text-muted-foreground">
          No matches. Try loosening filters (remove chips) or a broader semantic query.
        </p>
      ) : null}

      <ul className="space-y-3">
        {results.map((r) => (
          <li
            key={r.id}
            className="rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link
                  href={`/dashboard/candidates/${r.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {r.firstName} {r.lastName}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {r.email}
                  {r.location ? ` · ${r.location}` : ""} · {r.experience} yrs
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.similarity != null ? (
                  <Badge variant="secondary">
                    sim {(r.similarity * 100).toFixed(0)}%
                  </Badge>
                ) : null}
                {r.noEmbedding ? (
                  <Badge className="bg-warning/15 text-warning">no embedding</Badge>
                ) : null}
                {r.screeningScore != null ? (
                  <Badge variant="secondary">screen {Math.round(r.screeningScore)}%</Badge>
                ) : null}
                {r.interviewScore != null ? (
                  <Badge variant="secondary">
                    interview {Math.round(r.interviewScore)}%
                  </Badge>
                ) : null}
              </div>
            </div>
            {r.summary ? (
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{r.summary}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1">
              {r.skills.slice(0, 8).map((s) => (
                <Badge key={s} variant="secondary">
                  {s}
                </Badge>
              ))}
              {r.tags.map((t) => (
                <Badge key={t} className="bg-primary/15 text-foreground">
                  {t}
                </Badge>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
