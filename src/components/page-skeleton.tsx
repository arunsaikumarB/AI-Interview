import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

/** Route-level loading placeholder shown inside the app shell while the next page streams in. */
export function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Bar className="h-7 w-56" />
        <Bar className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass-card space-y-3 p-5">
            <Bar className="h-3 w-24" />
            <Bar className="h-6 w-16" />
          </div>
        ))}
      </div>
      <div className="glass-card space-y-3 p-5">
        {Array.from({ length: 6 }, (_, i) => (
          <Bar key={i} className={cn("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </div>
  );
}
