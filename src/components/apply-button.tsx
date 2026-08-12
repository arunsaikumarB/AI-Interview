"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ApplyButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function apply() {
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMessage(data.error ?? "Could not apply");
      return;
    }
    setMessage("Applied");
    router.push("/candidate/applications");
    router.refresh();
  }

  return (
    <div className="text-right">
      <Button onClick={apply} disabled={loading}>
        {loading ? "Applying…" : "Apply"}
      </Button>
      {message ? <p className="mt-1 text-xs text-slate-500">{message}</p> : null}
    </div>
  );
}
