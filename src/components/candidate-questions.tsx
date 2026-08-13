"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Exchange = { question: string; answer: string };

export function CandidateQuestions({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [remaining, setRemaining] = useState(3);

  async function ask() {
    if (!question.trim() || remaining <= 0) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/interview/${token}/candidate-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question.trim() }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not answer");
      if (data.maxReached) onDone();
      return;
    }
    if (data.declined) {
      setQuestion("");
      onDone();
      return;
    }
    setExchanges((prev) => [
      ...prev,
      { question: question.trim(), answer: data.answer },
    ]);
    setQuestion("");
    setRemaining(typeof data.remaining === "number" ? data.remaining : remaining - 1);
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
      <p className="text-sm uppercase tracking-wide text-muted-foreground">
        Almost done
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Do you have any questions about the role?
      </h1>
      <p className="text-sm text-muted-foreground">
        You can ask up to 3 questions. Answers come only from the job posting
        (title, location, description). Salary, benefits, and feedback are always
        deferred to the hiring team. Not scored.
      </p>

      {exchanges.length > 0 ? (
        <ul className="space-y-3">
          {exchanges.map((ex, i) => (
            <li key={i} className="rounded-lg bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">Q: {ex.question}</p>
              <p className="mt-1 text-muted-foreground">A: {ex.answer}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {remaining > 0 ? (
        <>
          <Textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about the role…"
            disabled={busy}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void ask()}
              disabled={busy || !question.trim()}
            >
              {busy ? "Answering…" : `Ask (${remaining} left)`}
            </Button>
            <Button variant="ghost" onClick={onDone} disabled={busy}>
              Skip
            </Button>
          </div>
        </>
      ) : (
        <Button className="w-full" onClick={onDone}>
          Finish
        </Button>
      )}
    </div>
  );
}
