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
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-medium text-slate-900">Candidate asked</h2>
      <p className="text-xs text-slate-500">
        Post-interview Q&amp;A — not scored and not part of the AI evaluation.
      </p>
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="border-t border-slate-100 pt-3 text-sm first:border-t-0 first:pt-0"
          >
            <p className="text-xs text-slate-400">{formatDateTime(item.at)}</p>
            <p className="mt-1 font-medium text-slate-900">Q: {item.question}</p>
            <p className="mt-1 text-slate-600">A: {item.answer}</p>
            {item.deferred ? (
              <p className="mt-1 text-xs text-amber-700">Deferred to hiring team</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
