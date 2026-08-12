"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function JobDeleteButton({ jobId }: { jobId: string }) {
  const router = useRouter();

  async function onDelete() {
    if (!confirm("Delete this job and its applications?")) return;
    const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Delete failed");
      return;
    }
    toast.success("Job deleted");
    router.push("/dashboard/jobs");
    router.refresh();
  }

  return (
    <Button variant="destructive" onClick={onDelete}>
      Delete
    </Button>
  );
}
