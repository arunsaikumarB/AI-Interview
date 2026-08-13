import { formatDateTime } from "@/lib/format";

export type CandidateAskedItem = {
  id: string;
  question: string;
  answer: string;
  deferred: boolean;
  at: string;
};

export function CandidateAskedSection({
  items,
}: {
  items: CandidateAskedItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-medium text-foreground">Candidate asked</h2>
      <p className="text-xs text-muted-foreground">
        Post-interview Q&amp;A — not scored and not part of the AI evaluation.
      </p>
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="border-t border-border pt-3 text-sm first:border-t-0 first:pt-0"
          >
            <p className="text-xs text-muted-foreground">{formatDateTime(item.at)}</p>
            <p className="mt-1 font-medium text-foreground">Q: {item.question}</p>
            <p className="mt-1 text-muted-foreground">A: {item.answer}</p>
            {item.deferred ? (
              <p className="mt-1 text-xs text-warning">Deferred to hiring team</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
