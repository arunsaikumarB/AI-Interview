import type {
  AdaptiveState,
  InterviewPlan,
  InterviewType,
  NextAction,
  PlanTopic,
  TurnResult,
} from "@/lib/ai/interview";

/**
 * Deterministic interview-question guards.
 * Next questions must stay on the JOB (not resume hobbies), never repeat,
 * and must not wait on the LLM — scoring can happen after the candidate
 * already has the next prompt.
 */

export type JobInterviewScope = {
  title: string;
  description: string;
  skills: string[];
  interviewType: string;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "about",
  "can",
  "could",
  "describe",
  "example",
  "for",
  "from",
  "give",
  "have",
  "how",
  "in",
  "into",
  "me",
  "of",
  "on",
  "or",
  "please",
  "project",
  "provide",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "use",
  "used",
  "using",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "would",
  "you",
  "your",
]);

/** Design-tool / UX-process language that is off-role for engineering jobs unless the JD asks for it. */
const DESIGN_TOOL_RE =
  /\b(figma|figjam|adobe\s*xd|photoshop|illustrator|sketch(?:\.app)?|canva|invision|wirefram(?:e|ing)|low[-\s]?fidelity|high[-\s]?fidelity\s+mock|ui\/ux design|ux design process|ux research|user research|product design|visual design|interaction design)\b/i;

const GENERIC_TOPIC_RE =
  /^(role overview|role fundamentals|core technical skills|recent project(?: deep-dive)?|problem solving|communication|competency \d+)$/i;

export function inferInterviewType(
  jobTitle: string,
  requested: InterviewType,
): InterviewType {
  if (
    requested === "HR" ||
    requested === "BEHAVIORAL" ||
    requested === "MANAGERIAL" ||
    requested === "CUSTOM"
  ) {
    return requested;
  }
  const t = jobTitle.toLowerCase();
  if (/full[\s-]?stack|fullstack/.test(t)) return "FULLSTACK";
  if (
    /\b(data scientist|data engineer|machine learning|ml engineer|ai engineer)\b/.test(
      t,
    )
  ) {
    return "DATA_AI";
  }
  return requested;
}

export function jobBlob(job: JobInterviewScope): string {
  return `${job.title} ${job.skills.join(" ")} ${job.description}`.toLowerCase();
}

export function jobAllowsDesignTools(job: JobInterviewScope): boolean {
  return DESIGN_TOOL_RE.test(jobBlob(job));
}

export function isEngineeringInterview(job: JobInterviewScope): boolean {
  const t = job.interviewType;
  if (t === "HR" || t === "BEHAVIORAL" || t === "MANAGERIAL") return false;
  if (t === "TECHNICAL" || t === "FULLSTACK" || t === "DATA_AI") return true;
  return /engineer|developer|fullstack|full-stack|backend|frontend|sre|devops/i.test(
    job.title,
  );
}

export function isOffRoleText(text: string, job: JobInterviewScope): boolean {
  if (!text.trim()) return false;
  if (!isEngineeringInterview(job)) return false;
  if (jobAllowsDesignTools(job)) return false;
  return DESIGN_TOOL_RE.test(text);
}

export function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(text: string): Set<string> {
  return new Set(
    normalizeQuestionText(text)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

export function questionsAreSimilar(a: string, b: string): boolean {
  const na = normalizeQuestionText(a);
  const nb = normalizeQuestionText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  Array.from(ta).forEach((tok) => {
    if (tb.has(tok)) overlap += 1;
  });
  const denom = Math.min(ta.size, tb.size);
  return overlap / denom >= 0.72;
}

export function questionConflicts(
  question: string,
  priorQuestions: string[],
  job: JobInterviewScope,
): boolean {
  if (isOffRoleText(question, job)) return true;
  return priorQuestions.some((p) => questionsAreSimilar(question, p));
}

export function defaultTopicsForRole(job: JobInterviewScope): string[] {
  const type = inferInterviewType(job.title, job.interviewType as InterviewType);
  if (type === "FULLSTACK" || /full[\s-]?stack/i.test(job.title)) {
    return [
      "Backend APIs",
      "Frontend architecture",
      "Databases and data modeling",
      "Authentication and security",
      "Debugging production issues",
    ];
  }
  if (type === "DATA_AI") {
    return [
      "SQL and data modeling",
      "Python for data work",
      "ML system design",
      "Experimentation",
      "Production reliability",
    ];
  }
  const fromJob = job.skills.map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (fromJob.length >= 3) return fromJob;
  return [
    "Role fundamentals",
    "Core technical skills",
    "Recent project deep-dive",
    "Problem solving",
  ];
}

function isGenericTopic(name: string): boolean {
  return GENERIC_TOPIC_RE.test(name.trim());
}

function questionBank(
  topic: string,
  jobTitle: string,
  kind: "opening" | "follow_up" | "deeper" | "new",
): string[] {
  const generic = isGenericTopic(topic);
  const problem =
    /problem solving|debug|production/i.test(topic) || topic === "Problem solving";
  const project = /recent project|project deep/i.test(topic);

  if (kind === "opening" || (kind === "new" && (generic || problem || project))) {
    if (problem) {
      return [
        `Walk me through a production bug or outage you owned. How did you find the cause, and what did you change?`,
        `Describe a time you had to debug something with incomplete information. What was your approach?`,
      ];
    }
    if (project) {
      return [
        `Pick a recent system you shipped for a role like ${jobTitle}. What was the architecture, and what did you personally own?`,
        `Tell me about the last feature you took from design to production. What was hardest?`,
      ];
    }
    return [
      `Tell me about a project most relevant to this ${jobTitle} role and what you personally owned.`,
      `Walk me through a system you built that matches this ${jobTitle} role — backend, frontend, or both.`,
    ];
  }

  switch (kind) {
    case "follow_up":
      return generic
        ? [
            `What did you personally implement, versus what the rest of the team owned?`,
            `What trade-offs did you choose, and what would you change now?`,
            `If that approach failed in production, how would you diagnose it?`,
          ]
        : [
            `You touched on ${topic} — walk me through one concrete example, including the trade-offs you chose.`,
            `What did you personally implement for ${topic}, versus what the rest of the team owned?`,
            `If that ${topic} approach failed in production, how would you diagnose it?`,
          ];
    case "deeper":
      return generic
        ? [
            `What's the hardest bug or scaling issue you hit on that work, and how did you fix it?`,
            `If usage of that system grew 10x, what would you change first?`,
          ]
        : [
            `What's the hardest bug or scaling issue you hit with ${topic}, and how did you fix it?`,
            `If usage of that ${topic} work grew 10x, what would you change first?`,
          ];
    default:
      return [
        `For this ${jobTitle} role, how have you used ${topic} in a real project?`,
        `Describe a system you built involving ${topic}. What was your part, and what shipped?`,
        `What decisions did you make around ${topic}, and what would you do differently now?`,
      ];
  }
}

export function synthesizeQuestion(params: {
  topic: string;
  jobTitle: string;
  kind: "opening" | "follow_up" | "deeper" | "new";
  priorQuestions: string[];
  job: JobInterviewScope;
}): string {
  const bank = questionBank(params.topic, params.jobTitle, params.kind);
  for (const q of bank) {
    if (!questionConflicts(q, params.priorQuestions, params.job)) return q;
  }
  const fallback = `Another angle for this ${params.jobTitle} role: what was a concrete technical decision you made related to ${params.topic}?`;
  if (!questionConflicts(fallback, params.priorQuestions, params.job)) {
    return fallback;
  }
  return `Let's shift to ${params.topic}. What would you do differently if you rebuilt that work today?`;
}

export function isNonAnswer(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length < 8 ||
    /^(i\s*don'?t\s*know|idk|n\/?a|no idea|pass)\.?$/i.test(trimmed)
  );
}

export function isSubstantialAnswer(text: string): boolean {
  return text.trim().length >= 160;
}

function onRoleTopics(plan: InterviewPlan, job: JobInterviewScope): PlanTopic[] {
  const kept = plan.topics.filter((t) => !isOffRoleText(`${t.name} ${t.why}`, job));
  const skillLike = kept.filter((t) => !isGenericTopic(t.name));
  const defaults = defaultTopicsForRole(job).map((name) => ({
    name,
    why: `Required for ${job.title}`,
    targetDifficulty: 3,
    fromResume: false,
  }));

  const mergeUnique = (primary: PlanTopic[], extra: PlanTopic[]) => {
    const out = [...primary];
    for (const t of extra) {
      if (!out.some((x) => questionsAreSimilar(x.name, t.name))) out.push(t);
    }
    return out.slice(0, 6);
  };

  if (isEngineeringInterview(job) && skillLike.length < 3) {
    return mergeUnique(defaults, skillLike);
  }
  if (kept.length >= 3) return kept.slice(0, 6);
  return mergeUnique(kept, defaults);
}

export function sanitizePlanForJob(
  plan: InterviewPlan,
  job: JobInterviewScope,
): InterviewPlan {
  const topics = onRoleTopics(plan, job);
  let opening = { ...plan.openingQuestion };
  if (
    isOffRoleText(`${opening.question} ${opening.topic}`, job) ||
    isOffRoleText(opening.question, job)
  ) {
    const topic = topics[0]!;
    opening = {
      question: synthesizeQuestion({
        topic: topic.name,
        jobTitle: job.title,
        kind: "opening",
        priorQuestions: [],
        job,
      }),
      topic: topic.name,
      difficulty: Math.min(topic.targetDifficulty, 3),
      competency: topic.name,
    };
  }
  const focusAreas = plan.focusAreas.filter((f) => !isOffRoleText(f, job));
  return { ...plan, topics, openingQuestion: opening, focusAreas };
}

export function nextOnRoleTopic(
  plan: InterviewPlan,
  fromIndex: number,
  job: JobInterviewScope,
  priorQuestions: string[],
): PlanTopic {
  const topics = onRoleTopics(plan, job);
  const start = Math.max(0, Math.min(fromIndex, Math.max(0, topics.length - 1)));
  for (let i = 0; i < topics.length; i++) {
    const idx = (start + i) % topics.length;
    const topic = topics[idx]!;
    if (isOffRoleText(topic.name, job)) continue;
    const preview = synthesizeQuestion({
      topic: topic.name,
      jobTitle: job.title,
      kind: "new",
      priorQuestions,
      job,
    });
    if (!questionConflicts(preview, priorQuestions, job)) return topic;
  }
  return topics[Math.min(start, topics.length - 1)] ?? {
    name: "Problem solving",
    why: `Core competency for ${job.title}`,
    targetDifficulty: 3,
    fromResume: false,
  };
}

function placeholderEvaluation(
  competency: string,
  score: number,
  reasoning: string,
): TurnResult["answerEvaluation"] {
  return {
    score,
    competency,
    strengths: ["Answer recorded"],
    weaknesses: ["Full model scoring runs after the next question is shown"],
    redFlags: [],
    reasoning,
  };
}

function buildQuestion(
  action: NextAction,
  topic: PlanTopic,
  job: JobInterviewScope,
  priorQuestions: string[],
): NonNullable<TurnResult["nextQuestion"]> {
  const kind =
    action === "FOLLOW_UP"
      ? "follow_up"
      : action === "GO_DEEPER"
        ? "deeper"
        : "new";
  return {
    question: synthesizeQuestion({
      topic: topic.name,
      jobTitle: job.title,
      kind,
      priorQuestions,
      job,
    }),
    topic: topic.name,
    difficulty:
      action === "GO_DEEPER"
        ? Math.min(5, topic.targetDifficulty + 1)
        : topic.targetDifficulty,
    competency: topic.name,
  };
}

/**
 * Pick the next question in code — no LLM. Never repeats, never drifts off the JD.
 */
export function decideNextTurn(params: {
  state: AdaptiveState;
  plan: InterviewPlan;
  maxQuestions: number;
  lastAnswerText: string;
  lastTopic?: string | null;
  priorQuestions: string[];
  job: JobInterviewScope;
  modelResult?: TurnResult | null;
}): { result: TurnResult; nextState: AdaptiveState } {
  const plan = sanitizePlanForJob(params.plan, params.job);
  const questionsAskedAfter = params.state.questionsAsked + 1;
  const nonAnswer = isNonAnswer(params.lastAnswerText);
  const substantial = isSubstantialAnswer(params.lastAnswerText);

  let action: NextAction = "NEW_TOPIC";
  let actionReasoning = "Answer recorded — advancing to a new on-role topic.";

  if (nonAnswer) {
    action =
      params.state.followUpsOnCurrentTopic < 2 ? "FOLLOW_UP" : "NEW_TOPIC";
    actionReasoning = nonAnswer
      ? "Short/non-answer — different follow-up, never the same question."
      : actionReasoning;
  } else if (params.state.followUpsOnCurrentTopic === 0 && substantial) {
    action = "GO_DEEPER";
    actionReasoning =
      "Substantial answer — one harder question on the same topic, then move on.";
  }

  if (
    params.modelResult &&
    !questionConflicts(
      params.modelResult.nextQuestion?.question ?? "",
      params.priorQuestions,
      params.job,
    ) &&
    params.modelResult.nextAction !== "FOLLOW_UP"
  ) {
    const modelAction = params.modelResult.nextAction;
    if (
      modelAction === "GO_DEEPER" ||
      modelAction === "NEW_TOPIC" ||
      modelAction === "EXPLORE" ||
      modelAction === "CONCLUDE"
    ) {
      action = modelAction === "EXPLORE" ? "GO_DEEPER" : modelAction;
      actionReasoning = params.modelResult.actionReasoning;
    }
  }

  if (action === "FOLLOW_UP" && params.state.followUpsOnCurrentTopic >= 2) {
    action = "NEW_TOPIC";
    actionReasoning = "Follow-up cap reached — new topic.";
  }

  if (
    action === "GO_DEEPER" &&
    (nonAnswer || params.lastAnswerText.trim().length < 80)
  ) {
    action = params.state.followUpsOnCurrentTopic < 2 ? "FOLLOW_UP" : "NEW_TOPIC";
  }

  if (questionsAskedAfter >= params.maxQuestions) {
    action = "CONCLUDE";
    actionReasoning = `maxQuestions (${params.maxQuestions}) reached.`;
  }

  const currentTopicName =
    plan.topics[params.state.currentTopicIndex]?.name ??
    params.lastTopic ??
    plan.topics[0]?.name ??
    "Role fundamentals";

  const evaluation = params.modelResult
    ? { ...params.modelResult.answerEvaluation }
    : placeholderEvaluation(
        currentTopicName,
        nonAnswer ? 18 : substantial ? 62 : 48,
        nonAnswer
          ? "Candidate did not provide a usable answer. Placeholder score until model review."
          : "Answer captured. Recruiter-facing model score is generated after the next question so the candidate is not kept waiting.",
      );

  if (nonAnswer) {
    evaluation.score = Math.min(evaluation.score, 20);
  }

  let nextQuestion: TurnResult["nextQuestion"] = null;
  let topicIndex = params.state.currentTopicIndex;
  let followUps = params.state.followUpsOnCurrentTopic;
  const topicsCovered = params.state.topicsCovered.map((t) => ({ ...t }));

  const bumpTopicScore = (name: string) => {
    const existing = topicsCovered.find((t) => t.name === name);
    if (existing) {
      existing.avgScore = Math.round((existing.avgScore + evaluation.score) / 2);
    } else {
      topicsCovered.push({ name, avgScore: evaluation.score });
    }
  };

  if (action !== "CONCLUDE") {
    if (action === "FOLLOW_UP" || action === "GO_DEEPER") {
      const topic =
        plan.topics[params.state.currentTopicIndex] ??
        nextOnRoleTopic(plan, params.state.currentTopicIndex, params.job, params.priorQuestions);
      nextQuestion = buildQuestion(
        action,
        topic,
        params.job,
        params.priorQuestions,
      );
      if (questionConflicts(nextQuestion.question, params.priorQuestions, params.job)) {
        action = "NEW_TOPIC";
      } else {
        followUps += 1;
        if (action !== "FOLLOW_UP") bumpTopicScore(currentTopicName);
      }
    }

    if (action === "NEW_TOPIC") {
      bumpTopicScore(currentTopicName);
      topicIndex = Math.min(
        params.state.currentTopicIndex + 1,
        Math.max(0, plan.topics.length - 1),
      );
      const topic = nextOnRoleTopic(
        plan,
        topicIndex,
        params.job,
        params.priorQuestions,
      );
      topicIndex = Math.max(
        0,
        plan.topics.findIndex((t) => t.name === topic.name),
      );
      nextQuestion = buildQuestion("NEW_TOPIC", topic, params.job, params.priorQuestions);
      followUps = 0;
    }
  } else {
    bumpTopicScore(currentTopicName);
    nextQuestion = null;
  }

  if (action !== "CONCLUDE" && nextQuestion) {
    if (questionConflicts(nextQuestion.question, params.priorQuestions, params.job)) {
      const topic = nextOnRoleTopic(
        plan,
        topicIndex + 1,
        params.job,
        params.priorQuestions,
      );
      nextQuestion = buildQuestion("NEW_TOPIC", topic, params.job, params.priorQuestions);
      action = "NEW_TOPIC";
      followUps = 0;
      topicIndex = Math.max(
        0,
        plan.topics.findIndex((t) => t.name === topic.name),
      );
    }
  }

  const nextState: AdaptiveState = {
    currentTopicIndex: topicIndex,
    questionsAsked: questionsAskedAfter,
    followUpsOnCurrentTopic: followUps,
    topicsCovered,
    difficulty: nextQuestion?.difficulty ?? params.state.difficulty,
    concluded: action === "CONCLUDE",
  };

  return {
    result: {
      answerEvaluation: evaluation,
      nextAction: action,
      actionReasoning,
      nextQuestion: action === "CONCLUDE" ? null : nextQuestion,
    },
    nextState,
  };
}

/** If the currently open question is a repeat or off-role, return a replacement. */
export function replacementForOpenQuestion(params: {
  currentQuestion: string;
  priorQuestions: string[];
  plan: InterviewPlan;
  job: JobInterviewScope;
  topicIndex?: number;
}): {
  question: string;
  topic: string;
  competency: string;
  difficulty: number;
} | null {
  if (
    !questionConflicts(
      params.currentQuestion,
      params.priorQuestions,
      params.job,
    )
  ) {
    return null;
  }
  const plan = sanitizePlanForJob(params.plan, params.job);
  const topic = nextOnRoleTopic(
    plan,
    params.topicIndex ?? 0,
    params.job,
    [...params.priorQuestions, params.currentQuestion],
  );
  const next = buildQuestion("NEW_TOPIC", topic, params.job, [
    ...params.priorQuestions,
    params.currentQuestion,
  ]);
  if (!next) return null;
  return {
    question: next.question,
    topic: next.topic,
    competency: next.competency,
    difficulty: next.difficulty,
  };
}
