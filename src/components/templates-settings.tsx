"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import {
  CATEGORY_LABELS,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
} from "@/lib/templates";

type Template = {
  id: string;
  name: string;
  category: string | null;
  subject: string;
  body: string;
};

type LogRow = {
  id: string;
  toAddress: string;
  status: string;
  subject: string | null;
  body: string | null;
  createdAt: string;
  sentAt: string | null;
  actor: { name: string } | null;
  template: { name: string } | null;
};

export function TemplatesSettings() {
  const [tab, setTab] = useState<"templates" | "sent">("templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "custom" as TemplateCategory,
    subject: "",
    body: "",
  });

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/templates");
    const data = await res.json();
    if (res.ok) setTemplates(data.templates ?? []);
  }, []);

  const loadLogs = useCallback(async () => {
    const res = await fetch("/api/communications?limit=100");
    const data = await res.json();
    if (res.ok) setLogs(data.logs ?? []);
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (tab === "sent") void loadLogs();
  }, [tab, loadLogs]);

  function startCreate() {
    setEditing(null);
    setForm({
      name: "",
      category: "custom",
      subject: "",
      body: "",
    });
  }

  function startEdit(t: Template) {
    setEditing(t);
    setForm({
      name: t.name,
      category: (t.category as TemplateCategory) || "custom",
      subject: t.subject,
      body: t.body,
    });
  }

  async function save() {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) {
      toast.error("Name, subject, and body are required");
      return;
    }
    const res = await fetch(
      editing ? `/api/templates/${editing.id}` : "/api/templates",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Save failed");
      return;
    }
    toast.success(editing ? "Template updated" : "Template created");
    setEditing(null);
    setForm({ name: "", category: "custom", subject: "", body: "" });
    await loadTemplates();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this template?")) return;
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Delete failed");
      return;
    }
    toast.success("Deleted");
    await loadTemplates();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={tab === "templates" ? "default" : "outline"}
          onClick={() => setTab("templates")}
        >
          Templates
        </Button>
        <Button
          size="sm"
          variant={tab === "sent" ? "default" : "outline"}
          onClick={() => setTab("sent")}
        >
          Sent log
        </Button>
      </div>

      {tab === "templates" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-slate-900">Org templates</h2>
              <Button size="sm" variant="outline" onClick={startCreate}>
                New
              </Button>
            </div>
            <ul className="space-y-2">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{t.name}</p>
                      <p className="text-xs text-slate-500">
                        {t.category
                          ? CATEGORY_LABELS[t.category as TemplateCategory] ??
                            t.category
                          : "—"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(t)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void remove(t.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
              {templates.length === 0 ? (
                <p className="text-sm text-slate-500">No templates yet.</p>
              ) : null}
            </ul>
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-medium text-slate-900">
              {editing ? "Edit template" : "Create template"}
            </h2>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target.value as TemplateCategory,
                  }))
                }
              >
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Subject</Label>
              <Input
                value={form.subject}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subject: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Body</Label>
              <Textarea
                rows={10}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
            </div>
            <p className="text-xs text-slate-500">
              Variables: {"{{candidateFirstName}}"}, {"{{jobTitle}}"},{" "}
              {"{{companyName}}"}, {"{{interviewLink}}"}, {"{{recruiterName}}"},{" "}
              {"{{stage}}"}, {"{{candidateLastName}}"}
            </p>
            <Button onClick={() => void save()}>
              {editing ? "Save changes" : "Create"}
            </Button>
          </section>
        </div>
      ) : (
        <section className="space-y-3">
          <h2 className="text-lg font-medium text-slate-900">
            Sent log (latest 100)
          </h2>
          <ul className="space-y-2">
            {logs.map((l) => (
              <li
                key={l.id}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={
                      l.status === "SENT"
                        ? "bg-emerald-100 text-emerald-900"
                        : l.status === "FAILED"
                          ? "bg-rose-100 text-rose-900"
                          : "bg-amber-100 text-amber-950"
                    }
                  >
                    {l.status}
                  </Badge>
                  <span className="font-medium text-slate-900">
                    {l.subject ?? "(no subject)"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  To {l.toAddress} · {formatDateTime(l.sentAt ?? l.createdAt)}
                  {l.actor ? ` · ${l.actor.name}` : ""}
                  {l.template ? ` · ${l.template.name}` : ""}
                </p>
              </li>
            ))}
            {logs.length === 0 ? (
              <p className="text-sm text-slate-500">No communication logs yet.</p>
            ) : null}
          </ul>
        </section>
      )}
    </div>
  );
}
