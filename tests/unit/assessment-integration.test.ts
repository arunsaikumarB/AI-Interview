/**
 * V3.1 — Assessment integration (pure layer; no database, no network).
 *
 * Component/overall status, required-component rule, evidence mapping and
 * traceability, blueprint → interview block, engine question queue, derived
 * practical links. Status words describe progress only — never PASS/FAIL/HIRE.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AssessmentEngineService } from "../../src/lib/assessment/service";
import { generateAiAssistedBlueprint } from "../../src/lib/assessment/ai-service";
import type { AiChatFn } from "../../src/lib/assessment/ai-generator";
import type { AiQuestionPromptInput } from "../../src/lib/assessment/ai-prompts";
import type { AssessmentBlueprint, CandidateInput, JobInput } from "../../src/lib/assessment/types";
import {
  buildComponents,
  completionSignature,
  interviewComponentState,
  overallState,
  practicalComponentState,
  progressOf,
  OVERALL_STATES,
  COMPONENT_STATES,
  type ComponentStatus,
  type InterviewRecord,
  type PracticalRecord,
} from "../../src/lib/candidate-assessment/status";
import { buildEvidence, matchBlueprintQuestion, practicalResultView } from "../../src/lib/candidate-assessment/evidence";
import {
  buildInterviewBlock,
  interviewQuestionBudget,
  planFromInterviewBlock,
  readInterviewBlock,
  type AssessmentInterviewBlock,
} from "../../src/lib/candidate-assessment/interview-block";
import { decideNextTurn, pendingAssessmentQuestions, type JobInterviewScope } from "../../src/lib/ai/interview-guard";
import { initialAdaptiveState, InterviewPlanSchema } from "../../src/lib/ai/interview";
import { ACCESS_TOKEN_RE, derivePracticalToken, hashAccessToken, isDerivedPracticalHash, newAccessToken } from "../../src/lib/practical/token";
import { humanTimelineTitle } from "../../src/lib/candidate-detail-ui";

process.env.AUTH_SECRET ||= "unit-test-auth-secret-not-used-anywhere-else-0123456789";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const BACKEND: JobInput = {
  id: "job-int",
  title: "Senior Backend Engineer",
  description: `Responsibilities:
- Design and build REST APIs in Node.js and TypeScript
- Own PostgreSQL schema design and query performance
Requirements:
- 5+ years of experience building backend services
- Strong experience with Node.js, PostgreSQL and Docker
Nice to have:
- Kafka, Kubernetes`,
  skills: ["Node.js", "TypeScript", "PostgreSQL"],
  experienceMin: 5,
  experienceMax: 8,
  screeningCriteria: { mustHave: ["Node.js"], niceToHave: ["Kafka"] },
};

const CANDIDATE: CandidateInput = {
  applicationId: "app-int",
  name: "Jane Doe",
  resumeText: `Experience
- Built REST APIs in Node.js serving 2M requests per day
- Migrated a PostgreSQL schema with zero downtime and reduced query latency by 40%
Skills: TypeScript, Kafka`,
  skills: ["TypeScript"],
};

const NOW = new Date("2026-09-29T12:00:00Z");
const FUTURE = new Date("2026-10-05T00:00:00Z");
const PAST = new Date("2026-09-20T00:00:00Z");

function v1(): AssessmentBlueprint {
  return AssessmentEngineService.buildBlueprint({ job: BACKEND, candidate: CANDIDATE, now: NOW });
}

function fallbackBlock(b = v1()): AssessmentInterviewBlock {
  const block = buildInterviewBlock(b, {
    status: "FALLBACK_PENDING_AI",
    total: 0,
    aiGenerated: 0,
    fallback: 0,
    model: null,
    upgradedAt: null,
  });
  assert.ok(block);
  return block;
}

const JOB_SCOPE: JobInterviewScope = {
  title: BACKEND.title,
  description: BACKEND.description,
  skills: BACKEND.skills,
  interviewType: "TECHNICAL",
};

function interview(p: Partial<InterviewRecord> = {}): InterviewRecord {
  return { id: "iv1", status: "SCHEDULED", tokenExpiresAt: FUTURE, createdAt: PAST, blueprintLinked: true, ...p };
}

function practical(p: Partial<PracticalRecord> = {}): PracticalRecord {
  return {
    id: "pa1",
    type: "CODING",
    status: "NOT_STARTED",
    tokenExpiresAt: FUTURE,
    createdAt: PAST,
    hasSubmission: false,
    runtimeMatchesRecommendation: true,
    ...p,
  };
}

const comp = (key: ComponentStatus["key"], state: ComponentStatus["state"], required: boolean): ComponentStatus => ({
  key,
  state,
  required,
  sourceId: state === "NOT_ASSIGNED" ? null : `${key}-id`,
});

// -----------------------------------------------------------------------------
// Component + overall status
// -----------------------------------------------------------------------------

describe("V3.1 component status", () => {
  it("1. maps interview statuses without inventing verdicts", () => {
    assert.equal(interviewComponentState(interview(), NOW), "NOT_STARTED");
    assert.equal(interviewComponentState(interview({ tokenExpiresAt: PAST }), NOW), "EXPIRED");
    assert.equal(interviewComponentState(interview({ status: "IN_PROGRESS" }), NOW), "IN_PROGRESS");
    assert.equal(interviewComponentState(interview({ status: "COMPLETED" }), NOW), "COMPLETED");
    assert.equal(interviewComponentState(interview({ status: "CANCELLED" }), NOW), "CANCELLED");
    assert.equal(interviewComponentState(interview({ status: "NO_SHOW" }), NOW), "EXPIRED");
    assert.equal(interviewComponentState(interview({ status: "TERMINATED" }), NOW), "FAILED");
  });

  it("2. maps V3 practical statuses; a timed-out submission is recorded evidence", () => {
    assert.equal(practicalComponentState(practical(), NOW), "NOT_STARTED");
    assert.equal(practicalComponentState(practical({ tokenExpiresAt: PAST }), NOW), "EXPIRED");
    for (const s of ["STARTED", "IN_PROGRESS", "SUBMITTED", "EXECUTING"]) {
      assert.equal(practicalComponentState(practical({ status: s }), NOW), "IN_PROGRESS", s);
    }
    assert.equal(practicalComponentState(practical({ status: "COMPLETED" }), NOW), "COMPLETED");
    assert.equal(practicalComponentState(practical({ status: "EXECUTION_FAILED" }), NOW), "FAILED");
    assert.equal(practicalComponentState(practical({ status: "TIMEOUT", hasSubmission: true }), NOW), "COMPLETED");
    assert.equal(practicalComponentState(practical({ status: "TIMEOUT", hasSubmission: false }), NOW), "EXPIRED");
    assert.equal(practicalComponentState(practical({ status: "CANCELLED" }), NOW), "CANCELLED");
  });

  it("3. the state vocabulary has no PASS / FAIL / HIRE / REJECT", () => {
    for (const s of [...COMPONENT_STATES, ...OVERALL_STATES]) {
      assert.ok(!/^(PASS|PASSED|HIRE|REJECT|REJECTED|SELECT|SELECTED|FAIL)$/.test(s), s);
    }
  });

  it("4. required rule: interview always; practical only when it matches the blueprint recommendation", () => {
    const c = buildComponents({
      interviews: [interview()],
      practicals: [practical(), practical({ id: "pa2", type: "SQL", runtimeMatchesRecommendation: false })],
      now: NOW,
    });
    assert.deepEqual(
      c.map((x) => [x.key, x.required]),
      [
        ["AI_INTERVIEW", true],
        ["CODING", true],
        ["SQL", false],
      ],
    );
    const none = buildComponents({ interviews: [], practicals: [], now: NOW });
    assert.ok(none.every((x) => x.state === "NOT_ASSIGNED"));
  });

  it("5. prefers the active blueprint-linked interview and the open practical attempt", () => {
    const c = buildComponents({
      interviews: [
        interview({ id: "old", status: "COMPLETED", blueprintLinked: false, createdAt: new Date("2026-09-25T00:00:00Z") }),
        interview({ id: "bp", status: "SCHEDULED", blueprintLinked: true, createdAt: new Date("2026-09-24T00:00:00Z") }),
      ],
      practicals: [
        practical({ id: "cancelled", status: "CANCELLED", createdAt: new Date("2026-09-28T00:00:00Z") }),
        practical({ id: "done", status: "COMPLETED", hasSubmission: true, createdAt: new Date("2026-09-27T00:00:00Z") }),
      ],
      now: NOW,
    });
    assert.equal(c[0]!.sourceId, "bp");
    assert.equal(c[1]!.sourceId, "done");
  });

  it("6. overall COMPLETED only when every assigned required component is completed; optional does not block", () => {
    assert.equal(
      overallState([comp("AI_INTERVIEW", "COMPLETED", true), comp("CODING", "COMPLETED", true), comp("SQL", "NOT_STARTED", false)]),
      "COMPLETED",
    );
    assert.equal(
      overallState([comp("AI_INTERVIEW", "COMPLETED", true), comp("CODING", "IN_PROGRESS", true), comp("SQL", "COMPLETED", false)]),
      "IN_PROGRESS",
    );
    assert.equal(overallState([comp("AI_INTERVIEW", "COMPLETED", true), comp("CODING", "NOT_ASSIGNED", false), comp("SQL", "NOT_ASSIGNED", false)]), "COMPLETED");
  });

  it("7. PARTIALLY_COMPLETED when required components ended without all completing; NOT_STARTED initially", () => {
    assert.equal(
      overallState([comp("AI_INTERVIEW", "COMPLETED", true), comp("CODING", "EXPIRED", true), comp("SQL", "NOT_ASSIGNED", false)]),
      "PARTIALLY_COMPLETED",
    );
    assert.equal(overallState([comp("AI_INTERVIEW", "FAILED", true), comp("CODING", "NOT_ASSIGNED", false), comp("SQL", "NOT_ASSIGNED", false)]), "PARTIALLY_COMPLETED");
    assert.equal(overallState([comp("AI_INTERVIEW", "NOT_STARTED", true), comp("CODING", "NOT_STARTED", true), comp("SQL", "NOT_ASSIGNED", false)]), "NOT_STARTED");
    assert.equal(overallState([comp("AI_INTERVIEW", "NOT_ASSIGNED", true), comp("CODING", "NOT_ASSIGNED", false), comp("SQL", "NOT_ASSIGNED", false)]), "NOT_STARTED");
  });

  it("8. cancelled / unassigned components are excluded from progress; signature is stable per component set", () => {
    const set = [comp("AI_INTERVIEW", "COMPLETED", true), comp("CODING", "CANCELLED", true), comp("SQL", "COMPLETED", false)];
    assert.deepEqual(progressOf(set), { completed: 2, total: 2, requiredCompleted: 1, requiredTotal: 1 });
    assert.equal(completionSignature(set), completionSignature([...set].reverse()));
    assert.notEqual(completionSignature(set), completionSignature([set[0]!, set[1]!, { ...set[2]!, sourceId: "other" }]));
  });

  it("9. client-supplied flags cannot mark completion: status is recomputed from records only", () => {
    const tampered = { ...practical({ status: "IN_PROGRESS" }), completed: true, state: "COMPLETED" } as PracticalRecord;
    const c = buildComponents({ interviews: [interview({ status: "COMPLETED" })], practicals: [tampered], now: NOW });
    assert.equal(c[1]!.state, "IN_PROGRESS");
    assert.equal(overallState(c), "IN_PROGRESS");
  });
});

// -----------------------------------------------------------------------------
// Blueprint → interview block
// -----------------------------------------------------------------------------

describe("V3.1 interview block", () => {
  it("10. carries validated V1 questions with competency, source, difficulty, evidence, rubric and generation mode", () => {
    const b = v1();
    const block = fallbackBlock(b);
    const askable = b.questions.filter((q) => q.type !== "PRACTICAL_RECOMMENDATION");
    assert.equal(block.questions.length, Math.min(20, askable.length));
    assert.ok(!block.questions.some((q) => q.type === "PRACTICAL_RECOMMENDATION"));
    for (const q of block.questions) {
      const spec = b.questions.find((s) => s.id === q.id)!;
      assert.equal(q.text, spec.text);
      assert.equal(q.competencyId, spec.competencyId);
      assert.equal(q.difficulty, spec.difficulty);
      assert.equal(q.source, spec.source);
      assert.deepEqual(q.expectedEvidence, spec.expectedEvidence.slice(0, 8));
      assert.ok(q.rubric.length >= 2);
      assert.equal(q.generationMode, "DETERMINISTIC_FALLBACK");
    }
    assert.equal(block.generation.fallback, block.questions.length);
    assert.equal(block.required, true);
    assert.equal(block.applicationId, CANDIDATE.applicationId);
  });

  it("11. without application context there is no block (nothing to personalise)", () => {
    const b = AssessmentEngineService.buildBlueprint({ job: BACKEND, now: NOW });
    assert.equal(buildInterviewBlock(b, { status: "FALLBACK_ONLY", total: 0, aiGenerated: 0, fallback: 0, model: null, upgradedAt: null }), null);
  });

  it("12. V2 AI-assisted wording is carried with AI_GENERATED provenance (mocked model)", async () => {
    const b = v1();
    const chat: AiChatFn = async (_system, user) => {
      const input = JSON.parse(user.split("<untrusted_data>")[1]!.split("</untrusted_data>")[0]!) as AiQuestionPromptInput;
      const c = input.slot.competency;
      const resume = input.evidence.resume[0];
      return {
        model: "mock-model",
        data: {
          question: {
            questionType: input.slot.questionType,
            competency: c,
            difficulty: input.slot.difficulty,
            text: resume
              ? `You mentioned: "${resume}". Walk me through how you approached that ${c} work and which trade-offs you weighed?`
              : `How would you apply ${c} on a new piece of work in this role, and which trade-offs would you weigh?`,
            purpose: `Assess ${c} at the expected level for this role.`,
            expectedEvidence: [`Explains ${c} decisions with concrete reasoning`, "Describes trade-offs and their consequences"],
            followUpRules: ["If the answer stays abstract, ask for one specific example."],
            rubric: input.guidance.rubricCriteria.map((r) => ({ criterion: r.criterion, weight: r.weight })),
          },
        },
      };
    };
    const ai = await generateAiAssistedBlueprint({
      blueprint: b,
      candidate: CANDIDATE,
      actorId: "staff",
      chat,
      options: { retryDelayMs: 0 },
      sleep: async () => {},
      audit: async () => {},
    });
    const block = buildInterviewBlock(ai, { status: "AI_ASSISTED", total: 0, aiGenerated: 0, fallback: 0, model: "mock-model", upgradedAt: NOW.toISOString() });
    assert.ok(block);
    assert.ok(block.generation.aiGenerated > 0);
    assert.equal(block.generation.aiGenerated + block.generation.fallback, block.questions.length);
    assert.ok(block.aiLayerVersion);
    const fallback = fallbackBlock(b);
    assert.deepEqual(
      block.questions.map((q) => [q.id, q.competencyId, q.type, q.difficulty]),
      fallback.questions.map((q) => [q.id, q.competencyId, q.type, q.difficulty]),
      "AI wording never changes the slot",
    );
  });

  it("13. plan seeded from the block: competencies as topics, first validated question opens, 4–8 topics", () => {
    const b = v1();
    const block = fallbackBlock(b);
    const plan = planFromInterviewBlock(block, b);
    assert.ok(plan.topics.length >= 4 && plan.topics.length <= 8);
    assert.equal(plan.openingQuestion.question, block.questions[0]!.text);
    assert.equal(plan.topics[0]!.name, block.questions[0]!.competency);
    const parsed = InterviewPlanSchema.parse(JSON.parse(JSON.stringify(plan)));
    assert.deepEqual(parsed.assessment, block, "block survives plan parse + re-save");
  });

  it("14. a malformed block is dropped instead of breaking the interview plan", () => {
    const b = v1();
    const plan = planFromInterviewBlock(fallbackBlock(b), b);
    const bad = { ...plan, assessment: { ...plan.assessment, questions: [{ id: "x", text: "hi" }] } };
    const parsed = InterviewPlanSchema.parse(bad);
    assert.equal(parsed.assessment, undefined);
    assert.equal(parsed.topics.length, plan.topics.length);
    assert.equal(readInterviewBlock(bad), null);
    assert.equal(readInterviewBlock({ ...plan, assessment: { ...plan.assessment, verdict: "HIRE" } }), null, "strict: no extra keys");
  });

  it("15. question budget always covers every validated question (max 30)", () => {
    const block = fallbackBlock();
    const n = block.questions.length;
    assert.ok(interviewQuestionBudget(block, 3) >= n);
    assert.ok(interviewQuestionBudget(block, undefined) >= n);
    assert.equal(interviewQuestionBudget(block, 30), 30);
  });
});

// -----------------------------------------------------------------------------
// Engine question queue
// -----------------------------------------------------------------------------

describe("V3.1 interview engine queue", () => {
  const LONG = "I designed the service boundary around the payments domain, measured p99 latency with tracing, and moved the hot path to a read replica after load testing showed lock contention on the primary.";

  function planAndBlock() {
    const b = v1();
    const block = fallbackBlock(b);
    return { block, plan: InterviewPlanSchema.parse(planFromInterviewBlock(block, b)) };
  }

  it("16. NEW_TOPIC asks the next validated blueprint question verbatim", () => {
    const { block, plan } = planAndBlock();
    const first = block.questions[0]!.text;
    const state = { ...initialAdaptiveState(), questionsAsked: 1, followUpsOnCurrentTopic: 2 };
    const { result } = decideNextTurn({
      state,
      plan,
      maxQuestions: 30,
      lastAnswerText: "ok",
      priorQuestions: [first],
      job: JOB_SCOPE,
    });
    assert.equal(result.nextAction, "NEW_TOPIC");
    const pending = pendingAssessmentQuestions(plan, [first], JOB_SCOPE);
    assert.equal(result.nextQuestion?.question, pending[0]!.text);
    assert.equal(result.nextQuestion?.competency, pending[0]!.competency);
  });

  it("17. follow-ups stay engine-generated while the budget allows", () => {
    const { block, plan } = planAndBlock();
    const first = block.questions[0]!.text;
    const { result } = decideNextTurn({
      state: initialAdaptiveState(),
      plan,
      maxQuestions: 30,
      lastAnswerText: LONG,
      priorQuestions: [first],
      job: JOB_SCOPE,
    });
    assert.equal(result.nextAction, "GO_DEEPER");
    assert.ok(!block.questions.some((q) => q.text === result.nextQuestion?.question));
  });

  it("18. when the budget is tight, follow-ups yield so every validated question is asked", () => {
    const { block, plan } = planAndBlock();
    const first = block.questions[0]!.text;
    const { result } = decideNextTurn({
      state: initialAdaptiveState(),
      plan,
      maxQuestions: block.questions.length,
      lastAnswerText: LONG,
      priorQuestions: [first],
      job: JOB_SCOPE,
    });
    assert.equal(result.nextAction, "NEW_TOPIC");
    assert.equal(result.nextQuestion?.question, pendingAssessmentQuestions(plan, [first], JOB_SCOPE)[0]!.text);
  });

  it("18b. every validated question is reachable, even when V1 templates share wording across competencies", () => {
    const { block, plan } = planAndBlock();
    const asked: string[] = [];
    for (;;) {
      const next = pendingAssessmentQuestions(plan, asked, JOB_SCOPE)[0];
      if (!next) break;
      asked.push(next.text);
    }
    assert.deepEqual(asked, block.questions.map((q) => q.text));
    const engineRepeat = `${block.questions[1]!.text} Please elaborate.`;
    assert.ok(!pendingAssessmentQuestions(plan, [engineRepeat], JOB_SCOPE).some((q) => q.id === block.questions[1]!.id), "still never near-repeats an engine question");
  });

  it("18c. a full blueprint interview asks each validated question exactly once", () => {
    const { block, plan } = planAndBlock();
    let state = { ...initialAdaptiveState() };
    const prior = [plan.openingQuestion.question];
    for (let i = 0; i < 40; i++) {
      const { result, nextState } = decideNextTurn({ state, plan, maxQuestions: interviewQuestionBudget(block, undefined), lastAnswerText: LONG, priorQuestions: prior, job: JOB_SCOPE });
      if (!result.nextQuestion) break;
      prior.push(result.nextQuestion.question);
      state = nextState;
    }
    for (const q of block.questions) assert.equal(prior.filter((p) => p === q.text).length, 1, q.id);
  });

  it("19. never repeats an asked blueprint question; legacy plans are unchanged", () => {
    const { block, plan } = planAndBlock();
    const asked = block.questions.map((q) => q.text);
    assert.equal(pendingAssessmentQuestions(plan, asked, JOB_SCOPE).length, 0);
    const { assessment: _drop, ...legacyRaw } = plan;
    const legacy = InterviewPlanSchema.parse(legacyRaw);
    assert.equal(pendingAssessmentQuestions(legacy, [], JOB_SCOPE).length, 0);
    const args = { state: { ...initialAdaptiveState(), questionsAsked: 1, followUpsOnCurrentTopic: 2 }, maxQuestions: 12, lastAnswerText: "ok", priorQuestions: [legacy.openingQuestion.question], job: JOB_SCOPE };
    const a = decideNextTurn({ ...args, plan: legacy });
    const b2 = decideNextTurn({ ...args, plan: legacy });
    assert.deepEqual(a, b2, "legacy path deterministic");
    assert.ok(!block.questions.some((q) => q.text === a.result.nextQuestion?.question) || a.result.nextQuestion === null);
  });
});

// -----------------------------------------------------------------------------
// Evidence + traceability
// -----------------------------------------------------------------------------

describe("V3.1 evidence mapping", () => {
  const V3_CODING_RESULT = {
    kind: "CODING",
    status: "COMPLETED",
    passed: 7,
    failed: 3,
    total: 10,
    runtimeMs: 412,
    memoryMb: 23.5,
    compileError: false,
    timedOut: false,
    resourceViolation: null,
    tests: [{ id: "t1", name: "hidden", visible: false, outcome: "PASSED" }],
    stdout: "secret",
  };

  function evidence() {
    const b = v1();
    const block = fallbackBlock(b);
    const q0 = block.questions[0]!;
    return {
      b,
      block,
      q0,
      out: buildEvidence({
        competencies: b.competencies,
        resume: {
          candidateId: "cand-1",
          at: NOW,
          byCompetency: b.resume.byCompetency.map((r) => ({ competencyId: r.competencyId, strength: r.strength, quotes: r.evidence.map((e) => e.quote) })),
        },
        interview: {
          sessionId: "sess-1",
          block,
          questions: [
            { id: "iq1", sequence: 1, question: q0.text, topic: q0.competency, competency: q0.competency, difficulty: "3", action: null, answer: { answeredAt: NOW, text: "answer" } },
            { id: "iq2", sequence: 2, question: "Engine follow-up about caching?", topic: "Legacy topic", competency: null, difficulty: "3", action: "FOLLOW_UP", answer: null },
          ],
        },
        practicals: [
          {
            id: "pa1",
            type: "CODING",
            title: "Task",
            taskKey: "k",
            taskVersion: 1,
            competency: q0.competency,
            status: "COMPLETED",
            required: true,
            submission: { id: "sub1", language: "python", execStatus: "COMPLETED", submittedAt: NOW, executedAt: NOW, result: V3_CODING_RESULT },
          },
        ],
      }),
    };
  }

  it("20. every blueprint competency appears; items link to their source ids", () => {
    const { b, q0, out } = evidence();
    for (const c of b.competencies) assert.ok(out.some((e) => e.competencyId === c.id), c.name);
    const entry = out.find((e) => e.competencyId === q0.competencyId)!;
    const iv = entry.items.find((i) => i.sourceType === "INTERVIEW")!;
    assert.equal(iv.sourceId, "iq1");
    assert.equal(iv.sourceType === "INTERVIEW" && iv.sessionId, "sess-1");
    assert.equal(iv.sourceType === "INTERVIEW" && iv.result.assessmentQuestionId, q0.id);
    assert.equal(iv.sourceType === "INTERVIEW" && iv.result.generationMode, "DETERMINISTIC_FALLBACK");
    const code = entry.items.find((i) => i.sourceType === "CODING")!;
    assert.equal(code.sourceId, "pa1");
    assert.equal(code.sourceType === "CODING" && code.submissionId, "sub1");
  });

  it("21. practical results are copied exactly as V3 recorded them — no re-run, no hidden tests or output", () => {
    const view = practicalResultView(V3_CODING_RESULT);
    assert.deepEqual(
      { passed: view.passed, failed: view.failed, total: view.total, runtimeMs: view.runtimeMs, memoryMb: view.memoryMb, timedOut: view.timedOut },
      { passed: 7, failed: 3, total: 10, runtimeMs: 412, memoryMb: 23.5, timedOut: false },
    );
    const json = JSON.stringify(view);
    assert.ok(!json.includes("hidden") && !json.includes("secret") && !("tests" in view));
    assert.equal(practicalResultView({ kind: "INFRASTRUCTURE", reason: "RUNNER_UNAVAILABLE" }).failureReason, "RUNNER_UNAVAILABLE");
    assert.equal(practicalResultView(null).passed, null, "missing stays null, never 0");
  });

  it("22. evidence carries no scores, ratings or decisions", () => {
    const { out } = evidence();
    const json = JSON.stringify(out);
    assert.ok(!/"(score|rating|overallScore|recommendation|decision|verdict|hire|reject)"/i.test(json));
  });

  it("23. engine follow-ups outside the blueprint are kept, labelled, not re-attributed", () => {
    const { out } = evidence();
    const extra = out.find((e) => e.competency === "Legacy topic")!;
    assert.equal(extra.inBlueprint, false);
    assert.equal(extra.items[0]!.sourceType === "INTERVIEW" && extra.items[0]!.result.fromBlueprint, false);
  });

  it("24. question matching is exact on validated text (normalised), never fuzzy", () => {
    const block = fallbackBlock();
    const q = block.questions[0]!;
    assert.equal(matchBlueprintQuestion(block, `  ${q.text.toUpperCase()}  `)?.id, q.id);
    assert.equal(matchBlueprintQuestion(block, `${q.text} Also tell me more.`), null);
    assert.equal(matchBlueprintQuestion(null, q.text), null);
  });
});

// -----------------------------------------------------------------------------
// Derived practical links + isolation guarantees
// -----------------------------------------------------------------------------

describe("V3.1 derived practical links", () => {
  it("25. derived token has the V3 token format, is per-assessment and matches only its own hash", () => {
    const t = derivePracticalToken("pa-1");
    assert.match(t, ACCESS_TOKEN_RE);
    assert.equal(derivePracticalToken("pa-1"), t);
    assert.notEqual(derivePracticalToken("pa-2"), t);
    assert.ok(isDerivedPracticalHash("pa-1", hashAccessToken(t)));
    assert.equal(isDerivedPracticalHash("pa-2", hashAccessToken(t)), false);
    assert.equal(isDerivedPracticalHash("pa-1", newAccessToken().hash), false, "random pre-V3.1 links are not launchable from the hub");
    assert.equal(isDerivedPracticalHash("pa-1", "abc"), false);
  });

  it("26. derived token depends on AUTH_SECRET", () => {
    const before = process.env.AUTH_SECRET;
    const t = derivePracticalToken("pa-1");
    process.env.AUTH_SECRET = `${before}-rotated`;
    try {
      assert.notEqual(derivePracticalToken("pa-1"), t);
    } finally {
      process.env.AUTH_SECRET = before;
    }
  });

  it("27. integration never touches stages, AI evaluations or proctoring", () => {
    for (const f of ["status.ts", "evidence.ts", "interview-block.ts", "service.ts"]) {
      const src = readFileSync(`src/lib/candidate-assessment/${f}`, "utf8");
      assert.ok(!/aIEvaluation\.|aiEvaluation\.|proctoringEvent|ProctoringEvent|stage:\s*["A-Z]|STAGE_CHANGED/.test(src), f);
    }
    const guard = readFileSync("src/lib/ai/interview-guard.ts", "utf8");
    assert.ok(!/proctor/i.test(guard.slice(guard.indexOf("pendingAssessmentQuestions"), guard.indexOf("defaultTopicsForRole"))));
  });

  it("28. candidate hub view type exposes no ids, rubrics, prompts or results", () => {
    const src = readFileSync("src/lib/candidate-assessment/service.ts", "utf8");
    const start = src.indexOf("export type CandidateComponentView");
    const typeSrc = src.slice(start, src.indexOf("const DESCRIPTIONS", start));
    for (const bad of ["rubric", "expectedEvidence", "prompt", "result", "competency", "applicationId", "candidateId", "score"]) {
      assert.ok(!typeSrc.includes(bad), bad);
    }
  });

  it("29. assessment audits have readable timeline titles", () => {
    for (const kind of [
      "assessment_link_issued",
      "assessment_link_revoked",
      "assessment_completed",
      "assessment_question_generation_failed",
    ]) {
      assert.notEqual(humanTimelineTitle("OTHER", { kind }), "Update recorded", kind);
    }
  });
});
