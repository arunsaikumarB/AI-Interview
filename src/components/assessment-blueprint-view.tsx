import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { familyLabel } from "@/lib/assessment/taxonomy";
import type {
  AssessmentBlueprint,
  CompetencySource,
  JdEvidence,
  QuestionSpec,
  ResumeEvidence,
} from "@/lib/assessment/types";
import type { AiAssistedBlueprint, AiAssistedQuestion, GenerationMode } from "@/lib/assessment/ai-schema";
import { cn } from "@/lib/utils";

const GENERATION_LABEL: Record<GenerationMode, string> = {
  DETERMINISTIC: "Generation: Deterministic",
  AI_GENERATED: "Generation: AI Generated",
  DETERMINISTIC_FALLBACK: "Generation: Deterministic Fallback",
};

const GENERATION_TONE: Record<GenerationMode, string> = {
  DETERMINISTIC: "",
  AI_GENERATED: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  DETERMINISTIC_FALLBACK: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
};

const SOURCE_LABEL: Record<CompetencySource, string> = {
  JD_REQUIRED: "JD required",
  JD_PREFERRED: "JD preferred",
  ROLE_STANDARD: "Role standard",
};

const IMPORTANCE_TONE: Record<string, string> = {
  CRITICAL: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  HIGH: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  MEDIUM: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  LOW: "border-border bg-muted text-muted-foreground",
};

function human(s: string): string {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function Section({ title, children, hint }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const JD_FIELD_LABEL: Record<JdEvidence["field"], string> = {
  title: "Title",
  description: "Description",
  skills: "Job skills",
  mustHave: "Must-have",
  niceToHave: "Nice-to-have",
  experienceRange: "Experience range",
};

function JdQuotes({ items }: { items: JdEvidence[] }) {
  if (!items.length) return <span className="text-xs text-muted-foreground">No JD evidence (role standard)</span>;
  return (
    <ul className="space-y-1">
      {items.map((e, i) => (
        <li key={i} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{JD_FIELD_LABEL[e.field]}:</span> “{e.text}”
        </li>
      ))}
    </ul>
  );
}

function ResumeQuotes({ items }: { items: ResumeEvidence[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1">
      {items.map((e, i) => (
        <li key={i} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {e.field === "resumeText" ? "Resume" : "Profile skill"} ({e.strength.toLowerCase()}):
          </span>{" "}
          “{e.quote}”
        </li>
      ))}
    </ul>
  );
}

function QuestionCard({
  q,
  competencySource,
}: {
  q: QuestionSpec | AiAssistedQuestion;
  competencySource?: CompetencySource;
}) {
  const mode: GenerationMode = "generationMode" in q ? q.generationMode : "DETERMINISTIC";
  const generation = "generation" in q ? q.generation : null;
  return (
    <li className="rounded-lg border border-border bg-background p-4">
      <p className="text-sm font-medium leading-relaxed text-foreground">{q.text}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant="outline" className={GENERATION_TONE[mode]}>
          {GENERATION_LABEL[mode]}
        </Badge>
        <Badge variant="secondary">{human(q.type)}</Badge>
        <Badge variant="outline">Source: {human(q.source)}</Badge>
        <Badge variant="outline">Difficulty {q.difficulty}/5</Badge>
        <Badge variant="outline">
          {q.competency}
          {competencySource ? ` · ${SOURCE_LABEL[competencySource]}` : ""}
        </Badge>
        <Badge variant="outline">{human(q.purpose)}</Badge>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expected evidence</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground/90">
            {q.expectedEvidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rubric (weights total 100)</p>
          <ul className="mt-1 space-y-0.5 text-xs text-foreground/90">
            {q.rubric.map((r) => (
              <li key={r.name} className="flex justify-between gap-3">
                <span>{r.name}</span>
                <span className="tabular-nums text-muted-foreground">{r.weight}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Traceability, follow-ups and guardrails
        </summary>
        <div className="mt-2 space-y-3">
          {generation ? (
            <div>
              <p className="font-semibold text-foreground/80">Generation</p>
              <p className="text-muted-foreground">
                {mode === "AI_GENERATED"
                  ? `Model wording accepted after ${generation.attempts} attempt(s) and validated against the V1 slot.`
                  : generation.failureType
                    ? `V1 wording kept (${human(generation.failureType)}, ${generation.attempts} attempt(s)).`
                    : "V1 wording kept."}
              </p>
              {generation.purposeStatement ? (
                <p className="mt-1 text-muted-foreground">Purpose: {generation.purposeStatement}</p>
              ) : null}
            </div>
          ) : null}
          <div>
            <p className="font-semibold text-foreground/80">JD evidence</p>
            <JdQuotes items={q.sourceEvidence.jd} />
          </div>
          {q.sourceEvidence.resume.length ? (
            <div>
              <p className="font-semibold text-foreground/80">Resume evidence</p>
              <ResumeQuotes items={q.sourceEvidence.resume} />
            </div>
          ) : null}
          <p className="text-muted-foreground">{q.difficultyRationale}</p>
          <div>
            <p className="font-semibold text-foreground/80">Follow-up rules</p>
            <ul className="list-disc pl-4 text-muted-foreground">
              {q.followUpRules.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-foreground/80">Disallowed assumptions</p>
            <ul className="list-disc pl-4 text-muted-foreground">
              {q.disallowedAssumptions.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </li>
  );
}

export function AssessmentBlueprintView({ blueprint }: { blueprint: AssessmentBlueprint | AiAssistedBlueprint }) {
  const { analysis, classification, competencies, plan, practical, questions, resume } = blueprint;
  const sourceById = new Map(competencies.map((c) => [c.id, c.source]));
  const confidencePct = Math.round(classification.confidence * 100);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Role family",
            value: familyLabel(classification.roleFamily),
            sub:
              classification.roleFamily === "HYBRID"
                ? classification.secondaryFamilies.map(familyLabel).join(" + ")
                : `${confidencePct}% confidence`,
          },
          {
            label: "Seniority",
            value: human(analysis.seniority === "UNKNOWN" ? "Not stated" : analysis.seniority),
            sub: analysis.seniorityEvidence ?? "No level in title or experience range",
          },
          { label: "Competencies", value: String(competencies.length), sub: `${competencies.filter((c) => c.source === "JD_REQUIRED").length} required by the JD` },
          { label: "Questions", value: String(plan.totalQuestions), sub: `~${plan.estimatedMinutes} min incl. practical` },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{m.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{m.sub}</p>
          </div>
        ))}
      </div>

      <Section
        title="Role classification"
        hint={`Confidence ${confidencePct}% — based on title, skill and description evidence only. Keyword evidence never implies certainty.`}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">
          {classification.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        {classification.roleFamily !== "HYBRID" && classification.secondaryFamilies.length ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Also resembles: {classification.secondaryFamilies.map(familyLabel).join(", ")}
          </p>
        ) : null}
        {analysis.missingInformation.length ? (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Missing JD information</p>
            <ul className="mt-1 list-disc pl-4 text-xs text-amber-900/90 dark:text-amber-200">
              {analysis.missingInformation.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {analysis.excludedStatements.length ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {analysis.excludedStatements.length} JD statement(s) referencing protected attributes were ignored and not used for any requirement.
          </p>
        ) : null}
      </Section>

      <Section title="Competency matrix" hint="JD required = stated in this job. Role standard = expected for the role family but not stated in the JD.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Competency</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Importance</th>
                <th className="py-2 pr-3 font-medium">Expected level</th>
                <th className="py-2 font-medium">Why / JD evidence</th>
              </tr>
            </thead>
            <tbody>
              {competencies.map((c) => (
                <tr key={c.id} className="border-b border-border/60 align-top last:border-0">
                  <td className="py-2 pr-3 font-medium text-foreground">{c.name}</td>
                  <td className="py-2 pr-3 text-foreground/80">{SOURCE_LABEL[c.source]}</td>
                  <td className="py-2 pr-3">
                    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-xs font-medium", IMPORTANCE_TONE[c.importance])}>
                      {human(c.importance)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-foreground/80">{human(c.expectedLevel)}</td>
                  <td className="py-2">
                    <p className="text-xs text-foreground/80">{c.explanation}</p>
                    <div className="mt-1">
                      <JdQuotes items={c.jdEvidence} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Assessment plan" hint={plan.rationale.join(" ")}>
        <ol className="space-y-2">
          {plan.stages.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {i + 1}. {s.title}
                </p>
                <p className="text-xs text-muted-foreground">{s.rationale}</p>
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {s.type === "PRACTICAL" ? `~${practical.estimatedMinutes} min` : `${s.questionCount} question(s) · ~${s.estimatedMinutes} min`}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title={`Practical recommendation: ${practical.title}`}
        hint="Recommendation only. HireOS V1 does not run, execute or grade practical exercises."
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Type</dt>
            <dd className="text-foreground">{human(practical.type)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Competency</dt>
            <dd className="text-foreground">{practical.competency}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Estimated difficulty / time</dt>
            <dd className="text-foreground">
              {practical.estimatedDifficulty}/5 · ~{practical.estimatedMinutes} min
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-foreground/90">{practical.reason}</p>
        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
          {practical.expectedEvidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </Section>

      {resume.availability !== "NO_CANDIDATE" ? (
        <Section
          title="Resume grounding"
          hint="Only verbatim resume text is quoted. Missing evidence is flagged, never filled in."
        >
          {resume.availability === "NO_RESUME" ? (
            <p className="text-sm text-muted-foreground">No resume text or profile skills on file for this candidate.</p>
          ) : (
            <ul className="space-y-2">
              {resume.byCompetency.map((r) => (
                <li key={r.competencyId} className="text-sm">
                  <span className="font-medium text-foreground">{r.competency}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    — {r.strength === "NONE" ? "No" : human(r.strength)} evidence
                  </span>
                  <div className="mt-0.5">
                    <ResumeQuotes items={r.evidence} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {resume.insufficient.length ? (
            <div className="mt-4 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <p className="text-xs font-semibold text-foreground">Insufficient resume evidence</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {resume.insufficient.map((i) => (
                  <li key={i.competencyId}>
                    {i.competency}: {i.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {resume.excludedLineCount ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {resume.excludedLineCount} resume line(s) were not used (contact details, protected attributes or instruction-like text).
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section title="Questions" hint="Each question links a competency, its JD/resume evidence and a rubric. Advisory — the recruiter decides.">
        <div className="space-y-6">
          {plan.stages.map((s) => {
            const stageQuestions = questions.filter((q) => q.stageId === s.id);
            if (!stageQuestions.length) return null;
            return (
              <div key={s.id}>
                <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
                <p className="text-xs text-muted-foreground">{s.purpose}</p>
                <ul className="mt-2 space-y-3">
                  {stageQuestions.map((q) => (
                    <QuestionCard key={q.id} q={q} competencySource={sourceById.get(q.competencyId)} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Limitations and checks">
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {blueprint.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
          {blueprint.validationIssues.length ? (
            <li>{blueprint.validationIssues.length} generated item(s) failed guardrail validation and were withheld.</li>
          ) : (
            <li>All generated questions passed guardrail validation.</li>
          )}
        </ul>
      </Section>
    </div>
  );
}
