"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AssessmentBlueprintView } from "@/components/assessment-blueprint-view";
import type { AiAssistedBlueprint } from "@/lib/assessment/ai-schema";

const AUDIT_NOTE: Record<AiAssistedBlueprint["generationSummary"]["audit"], string | null> = {
  RECORDED: "Fallbacks were recorded on the candidate timeline.",
  NOT_NEEDED: null,
  NO_APPLICATION: "Job-level blueprint: fallbacks are not attached to a candidate timeline.",
  WRITE_FAILED: "Fallbacks could not be recorded on the candidate timeline.",
};

/**
 * Staff-only toggle between the server-rendered deterministic blueprint
 * (children) and an AI-assisted one generated on request.
 */
export function AssessmentAiGenerate({
  jobId,
  applicationId,
  children,
}: {
  jobId: string;
  applicationId: string | null;
  children: ReactNode;
}) {
  const [ai, setAi] = useState<AiAssistedBlueprint | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/assessment-blueprint/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applicationId ? { applicationId } : {}),
      });
      const data = (await res.json().catch(() => null)) as (AiAssistedBlueprint & { error?: string }) | null;
      if (!res.ok || !data || data.blueprintMode !== "AI_ASSISTED") {
        setError(data?.error ?? "AI-assisted questions could not be generated. The deterministic blueprint is unchanged.");
        return;
      }
      setAi(data);
      setShowAi(true);
    } catch {
      setError("AI-assisted questions could not be generated. The deterministic blueprint is unchanged.");
    } finally {
      setLoading(false);
    }
  }

  const active = showAi && ai;
  const summary = ai?.generationSummary;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="space-y-1">
          <Badge variant={active ? "secondary" : "outline"}>
            {active ? "AI-Assisted Blueprint" : "Deterministic Blueprint"}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {active && summary
              ? `${summary.aiGenerated} of ${summary.total} question(s) AI generated · ${summary.fallback} deterministic fallback${summary.model ? ` · model ${summary.model}` : ""}`
              : "Rule-based questions from V1. AI wording is optional and validated against this blueprint."}
          </p>
          {active && summary && AUDIT_NOTE[summary.audit] ? (
            <p className="text-xs text-muted-foreground">{AUDIT_NOTE[summary.audit]}</p>
          ) : null}
          {loading ? (
            <p className="text-xs text-muted-foreground" role="status">
              The local model writes one question at a time. This can take a few minutes.
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {ai ? (
            <Button variant="outline" size="sm" onClick={() => setShowAi((v) => !v)} disabled={loading}>
              {showAi ? "Show Deterministic Blueprint" : "Show AI-Assisted Blueprint"}
            </Button>
          ) : null}
          <Button size="sm" onClick={generate} disabled={loading}>
            {loading ? "Generating questions…" : ai ? "Regenerate AI Questions" : "Generate AI Questions"}
          </Button>
        </div>
      </section>
      {active ? <AssessmentBlueprintView blueprint={active} /> : children}
    </div>
  );
}
