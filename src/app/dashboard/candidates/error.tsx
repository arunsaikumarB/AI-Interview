"use client";

import { Button } from "@/components/ui/button";

export default function CandidatesError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-xl border border-border p-8 text-center">
      <p className="text-sm text-foreground">Could not load candidates. Try again.</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}
