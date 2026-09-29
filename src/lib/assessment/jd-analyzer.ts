import { cleanText, findProtectedAttributes, truncate } from "./guardrails";
import { detectSkills, lookupSkill, TECHNICAL_SKILL_CATEGORIES } from "./skills";
import type {
  Importance,
  JdAnalysis,
  JdEvidence,
  JdField,
  JdSkill,
  JobInput,
  Seniority,
} from "./types";

const IMPORTANCE_RANK: Record<Importance, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

type Section = "NONE" | "REQUIRED" | "PREFERRED" | "RESPONSIBILITIES" | "OTHER";
type Cue = "REQUIRED" | "PREFERRED" | "RESPONSIBILITY" | "NEUTRAL";

/** Matched against a whole line (or the part before a colon), never a prefix of prose. */
const HEADERS: { section: Section; re: RegExp }[] = [
  { section: "PREFERRED", re: /^(?:nice[- ]to[- ]haves?|preferred(?: qualifications| skills)?|bonus(?: points)?|good[- ]to[- ]haves?|pluses|desirable(?: skills)?)$/i },
  { section: "REQUIRED", re: /^(?:requirements?|required(?: skills| qualifications)?|must[- ]haves?|(?:minimum |basic )?qualifications|what you(?:'ll)? bring|what we(?:'re| are) looking for|(?:key |required |technical )?skills(?: required)?|who you are|you have|tech stack)$/i },
  { section: "RESPONSIBILITIES", re: /^(?:(?:key |main )?responsibilities|what you(?:'ll| will) do|duties|the role|role overview|your role|day[- ]to[- ]day|you will)$/i },
  { section: "OTHER", re: /^(?:benefits|perks|about us|about the company|about the team|who we are|why join(?: us)?|what we offer|compensation|equal opportunity(?: employer)?|eeo)$/i },
];

/** Equal-opportunity boilerplate mentions protected attributes to disclaim them — not a requirement. */
const EEO_BOILERPLATE =
  /\b(equal opportunity|regardless of|without regard to|(?:do|does|will) not discriminate|all qualified applicants|celebrate diversity)\b/i;

const PREFERRED_CUE =
  /\b(nice[- ]to[- ]have|preferred|bonus|a plus|is a plus|good[- ]to[- ]have|desirable|familiarity with|exposure to|ideally)\b/i;
const REQUIRED_CUE =
  /\b(must|required|requirement|mandatory|essential|strong|proficien\w*|solid|expert\w*|hands[- ]on|experience (?:with|in|using|building)|you have|you bring|knowledge of|expertise in|deep understanding)\b/i;
const RESPONSIBILITY_START =
  /^(build|design|develop|implement|maintain|own|lead|write|create|collaborate|work|manage|analy[sz]e|drive|deliver|test|deploy|monitor|support|define|conduct|improve|optimi[sz]e|partner|mentor|review|document|translate|gather|prioriti[sz]e|coordinate|troubleshoot|automate|plan|research|facilitate|run|operate|ensure|architect|investigate|present)\b/i;
const RESPONSIBILITY_CUE = /\b(you will|you'll|responsible for|your day)\b/i;

const LEADERSHIP_CUE =
  /\b(lead(?:ing)? (?:a |the )?(?:team|engineers|squad)|mentor\w*|manag(?:e|ing) (?:a )?team|people management|line manag\w*|coach\w*|direct reports|technical leadership|leadership)\b/i;
const COMMUNICATION_CUE =
  /\b(communicat\w*|stakeholders?|presentations?|present to|written and verbal|verbal and written|cross[- ]functional|collaborat\w*)\b/i;

const DOMAINS: { name: string; re: RegExp }[] = [
  { name: "Fintech / financial services", re: /\b(fintech|payments?|banking|financial services|trading|lending)\b/i },
  { name: "Healthcare", re: /\b(healthcare|health ?tech|clinical|hospitals?|patients?|medical records)\b/i },
  { name: "E-commerce / retail", re: /\b(e-?commerce|retail|marketplace|online store)\b/i },
  { name: "Insurance", re: /\b(insurance|insurtech|claims processing)\b/i },
  { name: "Logistics / supply chain", re: /\b(logistics|supply chain|shipping|warehous\w+|fleet)\b/i },
  { name: "Education", re: /\b(edtech|education|learning platform|e-?learning)\b/i },
  { name: "SaaS / B2B software", re: /\b(saas|b2b software|enterprise software)\b/i },
  { name: "Telecommunications", re: /\b(telecom\w*|5g|network operators?)\b/i },
  { name: "Gaming", re: /\b(gaming|game studio|video games?)\b/i },
  { name: "Public sector", re: /\b(public sector|government|govtech)\b/i },
];

const YEARS_RE =
  /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:professional|relevant|industry|hands-on|work))?\s+(?:experience|exp\b)/i;

function stripBullet(line: string): string {
  return line.replace(/^[\s•●▪◦*\-–—·>]+/, "").replace(/^\d{1,2}[.)]\s+/, "").trim();
}

function detectHeader(line: string): { section: Section; rest: string } | null {
  const colon = line.indexOf(":");
  const head = (colon >= 0 ? line.slice(0, colon) : line).replace(/[\-–—#*]+$/, "").trim();
  if (!head || head.length > 60) return null;
  for (const h of HEADERS) {
    if (h.re.test(head)) return { section: h.section, rest: colon >= 0 ? line.slice(colon + 1).trim() : "" };
  }
  return null;
}

function splitStatements(description: string): { text: string; section: Section }[] {
  const out: { text: string; section: Section }[] = [];
  let section: Section = "NONE";
  for (const rawLine of description.split(/\r?\n/)) {
    const line = cleanText(stripBullet(rawLine.replace(/^#+\s*/, "")));
    if (!line) continue;
    const header = detectHeader(line);
    if (header) {
      section = header.section;
      // "Requirements: 5+ years of Python" — keep the remainder as a statement.
      if (header.rest) out.push({ text: header.rest, section });
      continue;
    }
    for (const sentence of line.split(/(?<=[.!?;])\s+(?=[A-Z0-9])/)) {
      const s = sentence.trim();
      if (s.length >= 3) out.push({ text: s, section });
    }
  }
  return out;
}

/** Description statements usable as classification signals (protected / boilerplate / "about us" removed). */
export function descriptionStatements(description: string): string[] {
  return splitStatements((description ?? "").slice(0, 20000))
    .filter(
      (s) =>
        s.section !== "OTHER" &&
        !EEO_BOILERPLATE.test(s.text) &&
        findProtectedAttributes(s.text).length === 0,
    )
    .map((s) => s.text);
}

function cueFor(text: string, section: Section): Cue {
  if (section === "PREFERRED" || PREFERRED_CUE.test(text)) return "PREFERRED";
  if (section === "REQUIRED" || REQUIRED_CUE.test(text)) return "REQUIRED";
  if (section === "RESPONSIBILITIES" || RESPONSIBILITY_START.test(text) || RESPONSIBILITY_CUE.test(text)) {
    return "RESPONSIBILITY";
  }
  return "NEUTRAL";
}

function stringList(v: unknown, max = 30): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => cleanText(x))
    .filter((x) => x.length > 0 && x.length <= 200)
    .slice(0, max);
}

function detectSeniority(job: JobInput, yearsFromText: { min: number | null; evidence: string } | null): {
  seniority: Seniority;
  evidence: string | null;
} {
  const title = job.title;
  const rules: { level: Seniority; re: RegExp }[] = [
    { level: "INTERN", re: /\b(intern|internship|trainee|apprentice)\b/i },
    { level: "PRINCIPAL", re: /\b(principal|distinguished|chief)\b/i },
    { level: "LEAD", re: /\b(lead|staff|head of|director)\b/i },
    { level: "SENIOR", re: /\b(senior|sr\.?|iii)\b/i },
    { level: "JUNIOR", re: /\b(junior|jr\.?|entry[- ]level|graduate|associate)\b/i },
    { level: "MID", re: /\b(mid[- ]level|intermediate|ii)\b/i },
  ];
  for (const r of rules) {
    const m = title.match(r.re);
    if (m) return { seniority: r.level, evidence: `Title contains "${m[0]}"` };
  }

  const hasRange = (job.experienceMin ?? 0) > 0 || job.experienceMax != null;
  const min = hasRange ? job.experienceMin ?? 0 : yearsFromText?.min ?? null;
  if (min == null) return { seniority: "UNKNOWN", evidence: null };
  const evidence = hasRange
    ? `Experience range ${job.experienceMin ?? 0}${job.experienceMax != null ? `–${job.experienceMax}` : "+"} years (job field)`
    : `Description: "${yearsFromText?.evidence}"`;
  if (min <= 1) return { seniority: "JUNIOR", evidence };
  if (min <= 4) return { seniority: "MID", evidence };
  if (min <= 7) return { seniority: "SENIOR", evidence };
  return { seniority: "LEAD", evidence };
}

type Mention = { skill: string; required: boolean; importance: Importance; evidence: JdEvidence };

function mergeSkills(mentions: Mention[]): JdSkill[] {
  const map = new Map<string, JdSkill>();
  for (const m of mentions) {
    const key = m.skill.toLowerCase();
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        skill: m.skill,
        required: m.required,
        importance: m.importance,
        source: "JD",
        evidence: [m.evidence],
      });
      continue;
    }
    cur.required = cur.required || m.required;
    if (IMPORTANCE_RANK[m.importance] > IMPORTANCE_RANK[cur.importance]) cur.importance = m.importance;
    if (
      cur.evidence.length < 4 &&
      !cur.evidence.some((e) => e.field === m.evidence.field && e.text === m.evidence.text)
    ) {
      cur.evidence.push(m.evidence);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance],
  );
}

function ev(field: JdField, text: string): JdEvidence {
  return { field, text: truncate(text, 300) };
}

/**
 * Deterministic JD analysis. Everything returned carries the exact JD text it
 * came from; nothing is inferred beyond the job record.
 */
export function analyzeJob(job: JobInput): JdAnalysis {
  const title = cleanText(job.title ?? "");
  const description = typeof job.description === "string" ? job.description.slice(0, 20000) : "";
  const criteria =
    job.screeningCriteria && typeof job.screeningCriteria === "object"
      ? (job.screeningCriteria as { mustHave?: unknown; niceToHave?: unknown })
      : {};
  const mustHave = stringList(criteria.mustHave);
  const niceToHave = stringList(criteria.niceToHave);
  const skillsField = stringList(job.skills, 40);

  const excludedStatements: JdAnalysis["excludedStatements"] = [];
  const excludeIfProtected = (text: string): boolean => {
    if (EEO_BOILERPLATE.test(text)) return true;
    const attrs = findProtectedAttributes(text);
    if (attrs.length) {
      excludedStatements.push({ text: truncate(text, 300), reason: "PROTECTED_ATTRIBUTE", attributes: attrs });
      return true;
    }
    return false;
  };

  const statements = splitStatements(description).filter((s) => !excludeIfProtected(s.text));
  const mentions: Mention[] = [];

  const niceKeys = new Set(niceToHave.map((s) => s.toLowerCase()));

  for (const item of mustHave) {
    if (excludeIfProtected(item)) continue;
    const detected = detectSkills(item);
    if (detected.length) {
      for (const d of detected) {
        mentions.push({ skill: d.name, required: true, importance: "CRITICAL", evidence: ev("mustHave", item) });
      }
    } else {
      mentions.push({ skill: truncate(item, 80), required: true, importance: "CRITICAL", evidence: ev("mustHave", item) });
    }
  }
  for (const item of skillsField) {
    if (excludeIfProtected(item)) continue;
    const detected = detectSkills(item);
    const preferred = niceKeys.has(item.toLowerCase());
    const names = detected.length ? detected.map((d) => d.name) : [lookupSkill(item)?.name ?? truncate(item, 80)];
    for (const name of names) {
      mentions.push({
        skill: name,
        required: !preferred,
        importance: preferred ? "MEDIUM" : "HIGH",
        evidence: ev("skills", item),
      });
    }
  }
  for (const item of niceToHave) {
    if (excludeIfProtected(item)) continue;
    const detected = detectSkills(item);
    const names = detected.length ? detected.map((d) => d.name) : [truncate(item, 80)];
    for (const name of names) {
      mentions.push({ skill: name, required: false, importance: "MEDIUM", evidence: ev("niceToHave", item) });
    }
  }

  const responsibilities: JdEvidence[] = [];
  const leadershipEv: string[] = [];
  const communicationEv: string[] = [];
  let years: { min: number | null; max: number | null; evidence: string } | null = null;

  for (const st of statements) {
    if (st.section === "OTHER") continue;
    const cue = cueFor(st.text, st.section);
    if (cue === "RESPONSIBILITY" && responsibilities.length < 12) {
      responsibilities.push(ev("description", st.text));
    }
    if (LEADERSHIP_CUE.test(st.text) && leadershipEv.length < 4) leadershipEv.push(truncate(st.text, 300));
    if (COMMUNICATION_CUE.test(st.text) && communicationEv.length < 4) communicationEv.push(truncate(st.text, 300));
    if (!years) {
      const m = st.text.match(YEARS_RE);
      if (m) {
        years = {
          min: Number(m[1]),
          max: m[2] ? Number(m[2]) : null,
          evidence: truncate(st.text, 300),
        };
      }
    }
    for (const d of detectSkills(st.text)) {
      const importance: Importance =
        cue === "REQUIRED" ? "HIGH" : cue === "RESPONSIBILITY" ? "MEDIUM" : cue === "PREFERRED" ? "LOW" : "LOW";
      mentions.push({
        skill: d.name,
        required: cue === "REQUIRED" || cue === "RESPONSIBILITY",
        importance,
        evidence: ev("description", st.text),
      });
    }
  }

  if ((job.experienceMin ?? 0) > 0 || job.experienceMax != null) {
    years = {
      min: job.experienceMin ?? 0,
      max: job.experienceMax ?? null,
      evidence: `Experience range ${job.experienceMin ?? 0}${job.experienceMax != null ? `–${job.experienceMax}` : "+"} years (job field)`,
    };
  }

  const domains: JdAnalysis["domains"] = [];
  for (const d of DOMAINS) {
    const hit = statements.find((s) => d.re.test(s.text));
    if (hit) domains.push({ name: d.name, evidence: truncate(hit.text, 300) });
    if (domains.length >= 3) break;
  }

  const merged = mergeSkills(mentions);
  const requiredSkills = merged.filter((s) => s.required);
  const preferredSkills = merged.filter((s) => !s.required);
  const technologies = merged
    .filter((s) => {
      const def = lookupSkill(s.skill);
      return def ? TECHNICAL_SKILL_CATEGORIES.has(def.category) : false;
    })
    .map((s) => s.skill);

  const { seniority, evidence: seniorityEvidence } = detectSeniority(job, years);

  const missingInformation: string[] = [];
  if (cleanText(description).length < 80) {
    missingInformation.push("Job description is very short; requirements may be incomplete.");
  }
  if (requiredSkills.length === 0) missingInformation.push("No explicit required skills found in the job.");
  if (seniority === "UNKNOWN") {
    missingInformation.push("Seniority is not stated (no level in the title and no experience range).");
  }
  if (responsibilities.length === 0) missingInformation.push("No responsibilities found in the description.");

  return {
    title,
    seniority,
    seniorityEvidence,
    responsibilities,
    requiredSkills,
    preferredSkills,
    technologies,
    domains,
    yearsOfExperience: years,
    leadership: { expected: leadershipEv.length > 0, evidence: leadershipEv },
    communication: { expected: communicationEv.length > 0, evidence: communicationEv },
    excludedStatements,
    missingInformation,
  };
}
