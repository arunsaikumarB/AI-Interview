"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  departmentIdForSubmit,
  departmentSelectOptions,
  initialDepartmentValue,
} from "@/lib/jobs/department-select";

type Dept = { id: string; name: string };
type Job = {
  id?: string;
  title: string;
  departmentId?: string | null;
  departmentName?: string | null;
  location?: string | null;
  description: string;
  skills?: string[];
  experienceMin?: number;
  experienceMax?: number | null;
  status: "DRAFT" | "OPEN" | "PAUSED" | "CLOSED";
  screeningCriteria?: { mustHave?: string[]; niceToHave?: string[] };
};

export function JobForm({ initial }: { initial?: Job }) {
  const router = useRouter();
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(false);
  // Controlled from the job itself, so the async /api/org load below can never
  // reset it. JOBS-05: an uncontrolled defaultValue is applied only on the
  // first render, when the matching <option> does not exist yet.
  const [departmentId, setDepartmentId] = useState<string>(() =>
    initialDepartmentValue(initial),
  );

  useEffect(() => {
    fetch("/api/org")
      .then((r) => r.json())
      .then((data) => {
        setDepartments(data.organizations?.[0]?.departments ?? []);
      })
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const skills = String(form.get("skills") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const mustHave = String(form.get("mustHave") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const niceToHave = String(form.get("niceToHave") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      title: String(form.get("title")),
      departmentId: departmentIdForSubmit(departmentId),
      location: String(form.get("location") || "") || null,
      description: String(form.get("description")),
      skills,
      experienceMin: Number(form.get("experienceMin") || 0),
      experienceMax: form.get("experienceMax")
        ? Number(form.get("experienceMax"))
        : null,
      status: String(form.get("status")) as Job["status"],
      screeningCriteria: { mustHave, niceToHave },
    };

    const res = await fetch(initial?.id ? `/api/jobs/${initial.id}` : "/api/jobs", {
      method: initial?.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error ?? "Save failed");
      return;
    }

    toast.success(initial?.id ? "Job updated" : "Job created");
    router.push(`/dashboard/jobs/${data.job.id}`);
    router.refresh();
  }

  const criteria = initial?.screeningCriteria ?? {};

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Job Title</Label>
        <Input id="title" name="title" required defaultValue={initial?.title} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="departmentId">Department</Label>
          <select
            id="departmentId"
            name="departmentId"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {departmentSelectOptions(
              departments,
              departmentId,
              initial?.departmentName,
            ).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "DRAFT"}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="DRAFT">Draft</option>
            <option value="OPEN">Open</option>
            <option value="PAUSED">Paused</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input id="location" name="location" defaultValue={initial?.location ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="experienceMin">Exp min (yrs)</Label>
          <Input
            id="experienceMin"
            name="experienceMin"
            type="number"
            min={0}
            defaultValue={initial?.experienceMin ?? 0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="experienceMax">Exp max (yrs)</Label>
          <Input
            id="experienceMax"
            name="experienceMax"
            type="number"
            min={0}
            defaultValue={initial?.experienceMax ?? ""}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="skills">Skills (comma-separated)</Label>
        <Input
          id="skills"
          name="skills"
          defaultValue={(initial?.skills ?? []).join(", ")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          required
          rows={5}
          defaultValue={initial?.description}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="mustHave">Requirements — must-have (one per line)</Label>
        <Textarea
          id="mustHave"
          name="mustHave"
          rows={3}
          defaultValue={(criteria.mustHave ?? []).join("\n")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="niceToHave">Nice-to-have criteria (one per line)</Label>
        <Textarea
          id="niceToHave"
          name="niceToHave"
          rows={3}
          defaultValue={(criteria.niceToHave ?? []).join("\n")}
        />
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        <Link
          href={initial?.id ? `/dashboard/jobs/${initial.id}` : "/dashboard/jobs"}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Cancel
        </Link>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : initial?.id ? "Update Job" : "Create Job"}
        </Button>
      </div>
    </form>
  );
}
