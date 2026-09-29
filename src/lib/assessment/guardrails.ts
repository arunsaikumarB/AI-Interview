import { validateRubric } from "./rubric";
import { detectSkills, lookupSkill, matchersFor, TECHNICAL_SKILL_CATEGORIES } from "./skills";
import {
  QuestionSpecSchema,
  type Competency,
  type QuestionSpec,
  type ValidationIssue,
} from "./types";

// -----------------------------------------------------------------------------
// Text hygiene
// -----------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g;

export function cleanText(s: string): string {
  return s.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

export function normalizeForMatch(s: string): string {
  return cleanText(s).toLowerCase();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

// -----------------------------------------------------------------------------
// Protected attributes — never extracted, quoted, inferred or asked about.
// -----------------------------------------------------------------------------

const PROTECTED_PATTERNS: { attribute: string; re: RegExp }[] = [
  {
    attribute: "age",
    re: /\b((?:your|their|his|her|candidate'?s|applicant'?s) age|how old|date of birth|d\.?o\.?b\.?|born (?:in|on)|\d{2}\s*(?:years?|yrs?)\s*old|aged?\s*(?:\d{2}|between|under|over|below|above|limit)|age\s*:|under \d{2}\b|below \d{2} years|young and dynamic|younger candidates|recent graduates only|digital natives?)\b/i,
  },
  {
    attribute: "gender",
    re: /\b(gender|male|female|men only|women only|man only|woman only|sex\s*:)\b/i,
  },
  {
    attribute: "marital status",
    re: /\b(marital status|married|unmarried|divorced|widowed|spouse)\b/i,
  },
  {
    attribute: "religion",
    re: /\b(religion|religious|christian|muslim|hindu|jewish|sikh|buddhist|caste)\b/i,
  },
  {
    attribute: "race or ethnicity",
    re: /\b(racial|ethnicity|ethnic origin|skin colou?r)\b|\brace\b(?!\s+conditions?)/i,
  },
  {
    attribute: "nationality",
    re: /\b(nationality|citizenship|citizen of|national origin|passport (?:no|number))\b/i,
  },
  {
    attribute: "disability",
    re: /\b(disabilit(?:y|ies)|disabled|handicap(?:ped)?|medical condition|health condition)\b/i,
  },
  {
    attribute: "pregnancy",
    re: /\b(pregnan(?:t|cy)|maternity|expecting a (?:baby|child))\b/i,
  },
  {
    attribute: "sexual orientation",
    re: /\b(sexual orientation|heterosexual|homosexual|gay|lesbian)\b/i,
  },
];

export function findProtectedAttributes(text: string): string[] {
  if (!text) return [];
  return PROTECTED_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.attribute);
}

/** Resume or JD lines that look like instructions aimed at an AI system. */
const INSTRUCTION_LIKE =
  /\b(ignore (?:all |any )?(?:previous|prior|above) instructions|system prompt|you are (?:an? |the )?(?:ai|assistant|language model)|disregard (?:the |all )?(?:rules|instructions))\b/i;

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_LIKE.test(text);
}

const CONTACT_LIKE = /@|https?:\/\/|www\.|\+?\d[\d\s().-]{8,}\d/;

export function looksLikeContactDetail(text: string): boolean {
  return CONTACT_LIKE.test(text);
}

/**
 * Broader than looksLikeInstruction: role markers, fake tool calls, prompt
 * extraction and decision manipulation aimed at a model. Applied to untrusted
 * JD/resume evidence before it reaches a prompt and to model output after.
 */
const PROMPT_INJECTION_LIKE = new RegExp(
  [
    INSTRUCTION_LIKE.source,
    String.raw`<\/?\s*(?:system|assistant|tool|developer|user)\s*>`,
    String.raw`\[\/?(?:system|inst|assistant)\]`,
    String.raw`<\|im_(?:start|end)\|>`,
    String.raw`(?:^|\n)\s*(?:system|assistant|developer|tool)\s*:`,
    String.raw`\b(?:call|invoke|execute|run) (?:the |a )?(?:tool|function|command|shell)\b`,
    String.raw`\bnew instructions?\b`,
    String.raw`\boverride (?:the |all |your )?(?:rules|instructions|policy|guardrails)\b`,
    String.raw`\b(?:reveal|print|show|output|repeat) (?:the |your )?(?:system |hidden |developer )?(?:prompt|instructions)\b`,
    String.raw`\bhidden instructions?\b`,
    String.raw`\b(?:mark|set|move|advance|shortlist|select|hire|reject) (?:this|the) (?:candidate|applicant)\b`,
    String.raw`\brecommend (?:hiring|hire|rejecting|rejection|reject)\b`,
    String.raw`\bas an ai\b`,
  ].join("|"),
  "i",
);

export function looksLikePromptInjection(text: string): boolean {
  return PROMPT_INJECTION_LIKE.test(text);
}

const DECISION_LANGUAGE =
  /\b(?:recommend(?:ed|s|ing)? (?:to )?(?:hire|hiring|reject|rejecting|rejection|shortlist(?:ing)?)|(?:hire|reject|shortlist|select|advance|fail|pass) (?:this|the) (?:candidate|applicant)|(?:move|advance|promote) (?:the candidate |the applicant |this candidate |them )?to (?:the )?(?:next|following) (?:stage|round)|(?:change|update) (?:the )?(?:pipeline |application )?(?:stage|status)|hiring decision|overall score|final verdict|auto-?(?:reject|advance|select))\b/i;

/** Prose that tries to act as a hiring decision, score or ATS move. */
export function hasDecisionLanguage(text: string): boolean {
  return DECISION_LANGUAGE.test(text);
}

const PLACEHOLDER = /\b(?:lorem ipsum|todo|tbd|placeholder|insert (?:question|text) here)\b|\bn\/a\b|\[insert|\{\{|\}\}|<question>/i;
const QUESTION_CUE =
  /\?|\b(?:describe|explain|walk (?:me|us) through|talk (?:me|us) through|tell (?:me|us)|how|what|why|which|when|where|design|outline|compare|discuss|share|give an example|sketch|propose|justify|evaluate|review)\b/i;

/** Empty, placeholder, repetitive or non-question text. */
export function isMeaninglessQuestion(text: string): boolean {
  const t = cleanText(text);
  if (t.length < 20) return true;
  const words = t.toLowerCase().match(/[a-z][a-z'+#.-]*/g) ?? [];
  if (words.length < 5) return true;
  if (new Set(words).size / words.length < 0.4) return true;
  if (PLACEHOLDER.test(t)) return true;
  return !QUESTION_CUE.test(t);
}

/** Supporting list items (expected evidence, follow-ups) that carry no content. */
export function isMeaninglessItem(text: string): boolean {
  const t = cleanText(text);
  if (t.length < 4) return true;
  if (PLACEHOLDER.test(t)) return true;
  return (t.match(/[a-z]{2,}/gi) ?? []).length < 2;
}

/** Canonical skills that name a practice or concept rather than a concrete tool. */
const CONCEPT_SKILLS: ReadonlySet<string> = new Set([
  "REST APIs",
  "Microservices",
  "Message queues",
  "Caching",
  "SQL",
  "NoSQL",
  "Database performance tuning",
  "Data modeling",
  "Data visualization",
  "Statistics",
  "Machine learning",
  "Deep learning",
  "NLP",
  "Computer vision",
  "LLMs",
  "MLOps",
  "Feature engineering",
  "ETL",
  "Data warehousing",
  "Streaming",
  "Networking",
  "Observability",
  "Incident management",
  "SLOs",
  "CI/CD",
  "Test automation",
  "Unit testing",
  "API testing",
  "Performance testing",
  "Manual testing",
  "Application security",
  "Network security",
  "Penetration testing",
  "Identity and access management",
  "Threat modeling",
  "Vulnerability management",
  "Security compliance",
  "System design",
  "Solution architecture",
  "Integration patterns",
  "Web accessibility",
  "Frontend performance",
]);

/** Generic words that happen to be aliases of a concrete skill. */
const GENERIC_ALIASES: ReadonlySet<string> = new Set([
  "containers",
  "containerization",
  "infrastructure as code",
  "=IaC",
  "lambda",
  "node",
  "version control",
  "unix",
]);

/** Concrete products listed as aliases of a concept skill (e.g. Redis under Caching). */
const NAMED_TOOL_ALIASES: ReadonlySet<string> = new Set([
  "redis",
  "memcached",
  "kafka",
  "rabbitmq",
  "sqs",
  "dynamodb",
  "cassandra",
  "prometheus",
  "grafana",
  "datadog",
  "jenkins",
  "github actions",
  "gitlab ci",
  "snowflake",
  "bigquery",
  "redshift",
  "flink",
  "kinesis",
  "jest",
  "pytest",
  "junit",
  "playwright",
  "postman",
  "jmeter",
  "k6",
  "splunk",
  "burp suite",
  "mlflow",
  "opencv",
  "numpy",
  "keras",
  "swagger",
  "openapi",
  "helm",
  "ec2",
  "s3",
]);

function matchedTerms(skillName: string, texts: string[]): string[] {
  const def = lookupSkill(skillName);
  const terms = def ? [def.name, ...def.aliases] : [skillName];
  const res = matchersFor(skillName);
  return terms.filter((t, i) => !(i === 0 && t.length <= 2) && texts.some((x) => res[i]?.test(x)));
}

function termIn(term: string, text: string): boolean {
  return matchersFor(term)[0]?.test(text) ?? false;
}

/**
 * Concrete technologies named in `texts` that the approved evidence does not
 * support. Concepts ("caching", "system design") are allowed; named tools must
 * match an allowed canonical skill, and tools filed under a concept skill must
 * appear literally in the allowed evidence text.
 */
export function findUnsupportedTechnologies(
  texts: string[],
  allowed: { skills: Iterable<string>; text: string },
): string[] {
  const allowSkills = new Set(Array.from(allowed.skills, (s) => s.toLowerCase()));
  const found = new Set<string>();
  for (const s of detectSkills(texts.join("\n"))) {
    if (!TECHNICAL_SKILL_CATEGORIES.has(s.category)) continue;
    for (const term of matchedTerms(s.name, texts)) {
      if (NAMED_TOOL_ALIASES.has(term.toLowerCase())) {
        if (!termIn(term, allowed.text)) found.add(term);
        continue;
      }
      if (CONCEPT_SKILLS.has(s.name) || GENERIC_ALIASES.has(term)) continue;
      if (!allowSkills.has(s.name.toLowerCase())) found.add(s.name);
    }
  }
  return Array.from(found);
}

/** Technical skills named in `texts`, by canonical name. */
export function technicalSkillsIn(texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    for (const s of detectSkills(t)) if (TECHNICAL_SKILL_CATEGORIES.has(s.category)) found.add(s.name);
  }
  return Array.from(found);
}

// -----------------------------------------------------------------------------
// Decision / certainty guards
// -----------------------------------------------------------------------------

/** Keys that would let generated content act as a hiring decision or ATS move. */
export const FORBIDDEN_DECISION_KEYS: ReadonlySet<string> = new Set([
  "stage",
  "newstage",
  "tostage",
  "pipelinestage",
  "status",
  "applicationstatus",
  "decision",
  "hiringdecision",
  "hire",
  "reject",
  "select",
  "autoreject",
  "autoselect",
  "autoadvance",
  "advance",
  "verdict",
  "recommendation",
]);

export function findForbiddenDecisionKeys(value: unknown, path = "$", depth = 0): string[] {
  if (depth > 8 || value === null || typeof value !== "object") return [];
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenDecisionKeys(v, `${path}[${i}]`, depth + 1)));
    return hits;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_DECISION_KEYS.has(k.toLowerCase())) hits.push(`${path}.${k}`);
    hits.push(...findForbiddenDecisionKeys(v, `${path}.${k}`, depth + 1));
  }
  return hits;
}

const UNSUPPORTED_CERTAINTY =
  /\b(guaranteed|certainly|definitely|undoubtedly|proven expert|100% (?:sure|certain)|without (?:a )?doubt)\b/i;

export function hasUnsupportedCertainty(text: string): boolean {
  return UNSUPPORTED_CERTAINTY.test(text);
}

/** Question text that asserts a resume fact without resume provenance. */
const RESUME_ASSERTION = /\b(your resume|your cv|on your resume|you (?:mentioned|listed|wrote|stated|claimed))\b/i;

// -----------------------------------------------------------------------------
// Question spec validation
// -----------------------------------------------------------------------------

export type SpecValidationContext = {
  competencies: Pick<Competency, "id" | "source" | "jdEvidence">[];
  resumeText: string | null;
  profileSkills: string[];
};

export function validateQuestionSpec(
  raw: unknown,
  ctx: SpecValidationContext,
): { ok: true; spec: QuestionSpec } | { ok: false; issues: ValidationIssue[] } {
  const rawId =
    raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string"
      ? ((raw as { id: string }).id as string)
      : undefined;
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssue["code"], detail: string) =>
    issues.push({ code, detail, questionId: rawId });

  const decisionKeys = findForbiddenDecisionKeys(raw);
  if (decisionKeys.length) {
    add("AUTO_DECISION_ATTEMPT", `Decision/stage fields are not allowed: ${decisionKeys.join(", ")}`);
  }

  const rubric = (raw as { rubric?: unknown } | null)?.rubric;
  if (Array.isArray(rubric)) {
    const r = validateRubric(rubric as { name?: unknown; weight?: unknown }[]);
    if (!r.ok) add("INVALID_RUBRIC_WEIGHTS", r.issues.join("; "));
  }

  if (issues.length) return { ok: false, issues };

  const parsed = QuestionSpecSchema.safeParse(raw);
  if (!parsed.success) {
    add(
      "MALFORMED",
      parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    );
    return { ok: false, issues };
  }
  const spec = parsed.data;

  const competency = ctx.competencies.find((c) => c.id === spec.competencyId);
  if (!competency) {
    add("MISSING_COMPETENCY_PROVENANCE", `Competency "${spec.competencyId}" is not in the competency matrix`);
  } else if (competency.source !== "ROLE_STANDARD" && competency.jdEvidence.length === 0) {
    add("MISSING_COMPETENCY_PROVENANCE", "JD-sourced competency has no JD evidence");
  }
  if ((spec.source === "JD" || spec.source === "SKILL") && spec.sourceEvidence.jd.length === 0) {
    add("MISSING_COMPETENCY_PROVENANCE", `Source ${spec.source} requires JD evidence`);
  }

  if (spec.source === "RESUME") {
    if (spec.sourceEvidence.resume.length === 0) {
      add("INVENTED_RESUME_CLAIM", "Resume-sourced question has no resume evidence");
    }
    const resumeNorm = ctx.resumeText ? normalizeForMatch(ctx.resumeText) : "";
    const skillsNorm = new Set(ctx.profileSkills.map((s) => normalizeForMatch(s)));
    for (const ev of spec.sourceEvidence.resume) {
      const q = normalizeForMatch(ev.quote);
      const found =
        ev.field === "resumeText" ? resumeNorm.length > 0 && resumeNorm.includes(q) : skillsNorm.has(q);
      if (!found) {
        add("INVENTED_RESUME_CLAIM", `Quoted resume evidence not found in the candidate's ${ev.field}`);
      }
    }
  } else if (RESUME_ASSERTION.test(spec.text)) {
    add("INVENTED_RESUME_CLAIM", "Question asserts resume content without resume evidence");
  }

  const textFields = [spec.text, ...spec.expectedEvidence, ...spec.followUpRules];
  const attrs = new Set(textFields.flatMap((t) => findProtectedAttributes(t)));
  if (attrs.size) {
    add("PROTECTED_ATTRIBUTE", `References protected attribute(s): ${Array.from(attrs).join(", ")}`);
  }

  // Verbatim resume quotes are the candidate's words, not the engine's claims.
  const ownWording = spec.sourceEvidence.resume.reduce(
    (t, e) => t.split(e.quote).join(" "),
    spec.text,
  );
  if ([ownWording, ...spec.expectedEvidence, ...spec.followUpRules].some((t) => hasUnsupportedCertainty(t))) {
    add("UNSUPPORTED_CERTAINTY", "Uses certainty language that evidence cannot support");
  }

  return issues.length ? { ok: false, issues } : { ok: true, spec };
}

/**
 * Boundary for model-produced question specs (future LLM phrasing step).
 * Malformed output fails closed: nothing is accepted and the caller keeps the
 * deterministic questions. Individually invalid specs are dropped with reasons.
 */
export function parseAiQuestionSpecs(
  raw: unknown,
  ctx: SpecValidationContext,
): {
  ok: boolean;
  error?: "AI_OUTPUT_INVALID" | "AUTO_DECISION_ATTEMPT";
  accepted: QuestionSpec[];
  rejected: { index: number; issues: ValidationIssue[] }[];
} {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions)
      ? ((raw as { questions: unknown[] }).questions as unknown[])
      : null;
  if (!list) return { ok: false, error: "AI_OUTPUT_INVALID", accepted: [], rejected: [] };

  if (!Array.isArray(raw)) {
    const { questions: _q, ...rest } = raw as Record<string, unknown>;
    void _q;
    if (findForbiddenDecisionKeys(rest).length) {
      return { ok: false, error: "AUTO_DECISION_ATTEMPT", accepted: [], rejected: [] };
    }
  }

  const accepted: QuestionSpec[] = [];
  const rejected: { index: number; issues: ValidationIssue[] }[] = [];
  list.slice(0, 40).forEach((item, index) => {
    const r = validateQuestionSpec(item, ctx);
    if (r.ok) accepted.push(r.spec);
    else rejected.push({ index, issues: r.issues });
  });
  return { ok: true, accepted, rejected };
}

export const STANDARD_DISALLOWED_ASSUMPTIONS = [
  "Do not assume experience beyond what the candidate states or the resume quotes.",
  "Do not infer or consider age, gender, race, religion, disability, nationality, pregnancy, marital status or any other protected attribute.",
  "Do not use proctoring or integrity signals as evidence of competency.",
  "Do not treat a rubric score as a hiring decision — the recruiter decides.",
] as const;
