"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { InterviewPlan, PlanTopic } from "@/lib/ai/interview";
import { cn } from "@/lib/utils";

type Props = {
  interviewId: string;
  initialPlan: InterviewPlan;
  editable: boolean;
  candidateLink: string;
  jobTitle: string;
  candidateName: string;
};

function newTopic(): PlanTopic {
  return {
    name: "New topic",
    why: "Added manually by recruiter",
    targetDifficulty: 3,
    fromResume: false,
  };
}

export function InterviewPlanEditor({
  interviewId,
  initialPlan,
  editable,
  candidateLink,
  jobTitle,
  candidateName,
}: Props) {
  const [plan, setPlan] = useState<InterviewPlan>(initialPlan);
  const [focusText, setFocusText] = useState(initialPlan.focusAreas.join(", "));
  const [saving, setSaving] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [pendingRefine, setPendingRefine] = useState<{
    plan: InterviewPlan;
    changeSummary: string[];
  } | null>(null);

  const topicIds = useMemo(
    () => plan.topics.map((_, i) => `topic-${i}`),
    [plan.topics],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function updateTopic(index: number, patch: Partial<PlanTopic>) {
    setPlan((p) => ({
      ...p,
      topics: p.topics.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = topicIds.indexOf(String(active.id));
    const newIndex = topicIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setPlan((p) => ({
      ...p,
      topics: arrayMove(p.topics, oldIndex, newIndex),
    }));
  }

  async function save(planToSave?: InterviewPlan) {
    if (!editable) return;
    setSaving(true);
    const base = planToSave ?? plan;
    const payload = {
      ...base,
      focusAreas: planToSave
        ? base.focusAreas
        : focusText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    };
    const res = await fetch(`/api/interviews/${interviewId}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error ?? "Could not save plan");
      return;
    }
    setPlan(data.plan);
    setPendingRefine(null);
    toast.success("Plan saved — interview will use this opening question");
  }

  async function runRefine() {
    if (!instruction.trim()) return;
    setRefineBusy(true);
    setPendingRefine(null);
    const res = await fetch(`/api/interviews/${interviewId}/plan/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction,
        plan: {
          ...plan,
          focusAreas: focusText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    });
    const data = await res.json();
    setRefineBusy(false);
    if (!res.ok) {
      toast.error(data.error ?? "Refine failed — plan unchanged");
      return;
    }
    setPendingRefine({
      plan: data.plan,
      changeSummary: data.changeSummary ?? [],
    });
  }

  async function copyLink() {
    await navigator.clipboard.writeText(candidateLink);
    toast.success("Candidate link copied");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          {candidateName} · {jobTitle}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
          Review interview plan
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Edit topics and the opening question before sharing the candidate
          link. Plan locks once the interview starts.
        </p>
        {!editable ? (
          <Badge className="mt-2 bg-warning/15 text-foreground">
            Locked — interview already started
          </Badge>
        ) : null}
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-medium text-foreground">Opening question</h2>
        <Textarea
          rows={3}
          disabled={!editable}
          value={plan.openingQuestion.question}
          onChange={(e) =>
            setPlan((p) => ({
              ...p,
              openingQuestion: {
                ...p.openingQuestion,
                question: e.target.value,
              },
            }))
          }
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Topic</Label>
            <Input
              disabled={!editable}
              value={plan.openingQuestion.topic}
              onChange={(e) =>
                setPlan((p) => ({
                  ...p,
                  openingQuestion: {
                    ...p.openingQuestion,
                    topic: e.target.value,
                  },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Difficulty (1–5)</Label>
            <Input
              type="number"
              min={1}
              max={5}
              disabled={!editable}
              value={plan.openingQuestion.difficulty}
              onChange={(e) =>
                setPlan((p) => ({
                  ...p,
                  openingQuestion: {
                    ...p.openingQuestion,
                    difficulty: Number(e.target.value) || 1,
                  },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Competency</Label>
            <Input
              disabled={!editable}
              value={plan.openingQuestion.competency}
              onChange={(e) =>
                setPlan((p) => ({
                  ...p,
                  openingQuestion: {
                    ...p.openingQuestion,
                    competency: e.target.value,
                  },
                }))
              }
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-foreground">Topics</h2>
          {editable ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setPlan((p) => ({ ...p, topics: [...p.topics, newTopic()] }))
              }
            >
              Add topic
            </Button>
          ) : null}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={topicIds} strategy={verticalListSortingStrategy}>
            <ul className="space-y-3">
              {plan.topics.map((topic, index) => (
                <SortableTopicCard
                  key={topicIds[index]}
                  id={topicIds[index]}
                  index={index}
                  topic={topic}
                  editable={editable}
                  onChange={(patch) => updateTopic(index, patch)}
                  onDelete={() =>
                    setPlan((p) => ({
                      ...p,
                      topics: p.topics.filter((_, i) => i !== index),
                    }))
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <Label>Focus areas (comma-separated)</Label>
        <Input
          disabled={!editable}
          value={focusText}
          onChange={(e) => setFocusText(e.target.value)}
        />
      </section>

      {editable ? (
        <section className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
          <h2 className="text-lg font-medium text-foreground">
            Refine with natural language
          </h2>
          <Textarea
            rows={2}
            placeholder='e.g. "make topic 2 about Kubernetes networking"'
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={refineBusy || !instruction.trim()}
            onClick={() => void runRefine()}
          >
            {refineBusy ? "Refining…" : "Preview refine"}
          </Button>
          {pendingRefine ? (
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-medium text-foreground">Proposed changes</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {pendingRefine.changeSummary.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const next = pendingRefine.plan;
                    setPlan(next);
                    setFocusText(next.focusAreas.join(", "));
                    void save(next);
                  }}
                >
                  Confirm & save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingRefine(null)}
                >
                  Discard
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {editable ? (
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save plan"}
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => void copyLink()}>
          Copy candidate link
        </Button>
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">{candidateLink}</p>
    </div>
  );
}

function SortableTopicCard({
  id,
  index,
  topic,
  editable,
  onChange,
  onDelete,
}: {
  id: string;
  index: number;
  topic: PlanTopic;
  editable: boolean;
  onChange: (patch: Partial<PlanTopic>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !editable });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-xl border border-border bg-card p-4",
        isDragging && "opacity-80 shadow-md",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {editable ? (
            <button
              type="button"
              className="cursor-grab rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              {...attributes}
              {...listeners}
            >
              Drag
            </button>
          ) : null}
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Topic {index + 1}
          </span>
          {topic.fromResume ? (
            <Badge className="bg-success/15 text-success">fromResume</Badge>
          ) : (
            <Badge variant="secondary">role</Badge>
          )}
        </div>
        {editable ? (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Name</Label>
          <Input
            disabled={!editable}
            value={topic.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Difficulty</Label>
          <Input
            type="number"
            min={1}
            max={5}
            disabled={!editable}
            value={topic.targetDifficulty}
            onChange={(e) =>
              onChange({ targetDifficulty: Number(e.target.value) || 1 })
            }
          />
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <Label>Why</Label>
        <Textarea
          rows={2}
          disabled={!editable}
          value={topic.why}
          onChange={(e) => onChange({ why: e.target.value })}
        />
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm text-foreground/90">
        <input
          type="checkbox"
          disabled={!editable}
          checked={topic.fromResume}
          onChange={(e) => onChange({ fromResume: e.target.checked })}
        />
        From resume
      </label>
    </li>
  );
}
