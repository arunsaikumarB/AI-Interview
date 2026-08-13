"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CATEGORY_LABELS,
  hasMissingMarkers,
  listTemplateVariables,
  renderTemplate,
  type TemplateCategory,
  type TemplateContext,
} from "@/lib/templates";

type TemplateRow = {
  id: string;
  name: string;
  category: string | null;
  subject: string;
  body: string;
};

type Props = {
  candidateId: string;
  applicationId?: string | null;
  /** Prefill category filter / template pick */
  category?: TemplateCategory | null;
  open: boolean;
  onClose: () => void;
};

export function ComposeEmailDialog({
  candidateId,
  applicationId,
  category,
  open,
  onClose,
}: Props) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [context, setContext] = useState<TemplateContext>({});
  const [mailMode, setMailMode] = useState<"smtp" | "clipboard">("clipboard");
  const [toEmail, setToEmail] = useState("");
  const [linkWarning, setLinkWarning] = useState<string | null>(null);
  const [resolvedAppId, setResolvedAppId] = useState<string | null>(
    applicationId ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [clipboardResult, setClipboardResult] = useState<{
    subject: string;
    body: string;
  } | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ candidateId });
    if (applicationId) qs.set("applicationId", applicationId);
    const [ctxRes, tplRes] = await Promise.all([
      fetch(`/api/communications/compose-context?${qs}`),
      fetch(
        category
          ? `/api/templates?category=${encodeURIComponent(category)}`
          : "/api/templates",
      ),
    ]);
    const ctx = await ctxRes.json();
    const tpl = await tplRes.json();
    if (!ctxRes.ok) {
      toast.error(ctx.error ?? "Could not load compose context");
      return;
    }
    setContext(ctx.context ?? {});
    setMailMode(ctx.mailMode === "smtp" ? "smtp" : "clipboard");
    setToEmail(ctx.candidate?.email ?? "");
    setLinkWarning(ctx.interviewLinkWarning ?? null);
    setResolvedAppId(ctx.applicationId ?? applicationId ?? null);

    const list = (tpl.templates ?? []) as TemplateRow[];
    setTemplates(list);
    const preferred =
      (category
        ? list.find((t) => t.category === category)
        : list[0]) ?? list[0];
    if (preferred) {
      setTemplateId(preferred.id);
      applyTemplate(preferred, ctx.context ?? {});
    }
  }, [applicationId, candidateId, category]);

  function applyTemplate(t: TemplateRow, ctx: TemplateContext) {
    const s = renderTemplate(t.subject, ctx);
    const b = renderTemplate(t.body, ctx);
    setSubject(s.rendered);
    setBody(b.rendered);
  }

  useEffect(() => {
    if (open) {
      setClipboardResult(null);
      void load();
    }
  }, [open, load]);

  const missing = useMemo(() => {
    const fromSubject = listTemplateVariables(subject).filter((v) =>
      subject.includes(`⚠️MISSING:${v}⚠️`),
    );
    const fromBody = listTemplateVariables(body).filter((v) =>
      body.includes(`⚠️MISSING:${v}⚠️`),
    );
    // Also detect markers even if variable list is empty after edit
    const markerNames: string[] = [];
    const re = /⚠️MISSING:([a-zA-Z0-9_]+)⚠️/g;
    let m: RegExpExecArray | null;
    const subj = subject;
    const bod = body;
    while ((m = re.exec(subj)) !== null) markerNames.push(m[1]);
    re.lastIndex = 0;
    while ((m = re.exec(bod)) !== null) markerNames.push(m[1]);
    return Array.from(new Set([...fromSubject, ...fromBody, ...markerNames]));
  }, [subject, body]);

  const blocked = hasMissingMarkers(subject) || hasMissingMarkers(body);

  async function send() {
    if (blocked) {
      toast.error("Fix missing variables before sending");
      return;
    }
    setBusy(true);
    setClipboardResult(null);
    const res = await fetch("/api/communications/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId,
        applicationId: resolvedAppId,
        templateId: templateId || null,
        subject,
        body,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast.error(data.error ?? "Send failed");
      return;
    }
    if (data.mode === "clipboard") {
      setClipboardResult(data.copy ?? { subject, body });
      toast.success("Draft saved — copy subject/body (clipboard mode)");
    } else {
      toast.success("Email sent");
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="glass-modal max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-medium text-foreground">Compose email</h2>
            <p className="text-xs text-muted-foreground">To: {toEmail}</p>
          </div>
          <Badge
            className={
              mailMode === "smtp"
                ? "bg-success/15 text-success"
                : "bg-warning/15 text-foreground"
            }
          >
            {mailMode === "smtp" ? "SMTP" : "Clipboard mode"}
          </Badge>
        </div>

        {mailMode === "clipboard" ? (
          <p className="mt-2 text-xs text-warning">
            No SMTP_HOST configured — Send creates a DRAFT log; use copy buttons.
          </p>
        ) : null}

        {linkWarning && category === "interview_invite" ? (
          <p className="mt-2 text-xs text-warning">{linkWarning}</p>
        ) : null}

        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label>Template</Label>
            <select
              className="h-9 w-full rounded-lg border border-border bg-input-background px-3 text-sm text-foreground"
              value={templateId}
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                setTemplateId(e.target.value);
                if (t) applyTemplate(t, context);
              }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.category
                    ? ` (${CATEGORY_LABELS[t.category as TemplateCategory] ?? t.category})`
                    : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Body</Label>
            <Textarea
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {blocked ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Missing variables — resolve before send:{" "}
              {missing.map((m) => `{{${m}}}`).join(", ") || "see ⚠️MISSING markers"}
            </p>
          ) : null}

          {clipboardResult ? (
            <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(clipboardResult.subject);
                  toast.success("Subject copied");
                }}
              >
                Copy subject
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(clipboardResult.body);
                  toast.success("Body copied");
                }}
              >
                Copy body
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void send()} disabled={busy || blocked}>
              {busy
                ? "Working…"
                : mailMode === "smtp"
                  ? "Send"
                  : "Save draft & copy"}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(subject);
                toast.success("Subject copied");
              }}
            >
              Copy subject
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(body);
                toast.success("Body copied");
              }}
            >
              Copy body
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
