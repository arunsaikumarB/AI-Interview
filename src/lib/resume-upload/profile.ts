/**
 * Rule-based reading of the rest of a resume: sections, skills, education,
 * certifications, summary, LinkedIn, location and experience from work dates.
 * Conservative on purpose: a field it cannot read with confidence stays empty
 * so the background AI pass can fill it.
 */

export type EducationEntry = { degree: string; institution: string; year: string };

export type ResumeProfile = {
  location: string;
  linkedIn: string;
  summary: string;
  skills: string[];
  education: EducationEntry[];
  certifications: string[];
  experienceYears: number | null;
};

type Section = "summary" | "skills" | "experience" | "education" | "certifications" | "other";

const MAX_SKILLS = 40;
const MAX_EDUCATION = 6;
const MAX_CERTIFICATIONS = 15;
const MAX_SUMMARY = 1500;

/** Designed resumes often letter-space words: "S e e t h a r a m   R e d d y". */
export function joinSpacedLetters(line: string): string {
  return line
    .split(/\t| {2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (/^(?:\S ){2,}\S$/.test(chunk) ? chunk.replace(/ /g, "") : chunk))
    .join(" ")
    .replace(/\s+/g, " ");
}

const HEADINGS: Array<[Section, RegExp]> = [
  ["summary", /^(?:(?:professional|career|executive) )?(?:summar\w*|objectiv\w*|profile|overview)$|^about(?: me)?$/],
  ["skills", /^(?:[a-z&]+ ){0,2}skil\w*(?: (?:set|summary|used))?$|^(?:core )?competenc\w*$|^(?:areas of )?expertise$|^technolog(?:y|ies)(?: used)?$|^tools?(?: (?:and|&) technolog\w*)?$|^tech(?:nical)? stack$|^proficienc\w*$/],
  ["experience", /^(?:(?:work|professional|relevant|industry|employment|career) )?(?:experienc\w*|history)$|^employment(?: history)?$|^internships?(?: experience)?$/],
  ["education", /^(?:educat\w*|academic\w*|qualificat\w*)(?: (?:details|qualificat\w*|background|profile))?$|^academic qualificat\w*$/],
  ["certifications", /^(?:certificat\w*|licen[cs]\w*|courses?|trainings?)(?: (?:and|&) (?:certificat\w*|courses?|trainings?|licen[cs]\w*))?$/],
  [
    "other",
    /^(?:(?:academic|personal|key|major|other) )?project\w*(?: details)?$|^(?:achievements?|awards?|honou?rs?|accomplishments?)(?: (?:and|&) \w+)?$|^languages?(?: known)?$|^(?:hobbies|interests?)(?: (?:and|&) \w+)?$|^declaration$|^personal (?:details|information|profile)$|^references?$|^publications?$|^extra[- ]?curricular(?: activities)?$|^strengths?$|^contact(?: \w+)?$|^(?:roles? (?:and|&) |key )?responsibilit\w*$|^description$|^(?:my )?design principl\w*$/,
  ],
];

const BULLET = /^[\s•·▪●○◦►▸✓✔*\-–—>+»«®]+/;

function normalizeHeading(line: string): string {
  return line
    .toLowerCase()
    .replace(BULLET, "")
    .replace(/[:|—–\-_.]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headingOf(line: string): Section | null {
  if (line.length > 45) return null;
  const h = normalizeHeading(line);
  if (!h || h.split(" ").length > 5) return null;
  for (const [section, re] of HEADINGS) if (re.test(h)) return section;
  return null;
}

/** Lines that start a new entry inside designed project blocks; they end a skills list. */
const ENTRY_START = /^(?:project\s*\d*\b|client\b|team(?: size)?\b|role\b|duration\b|company\b|environment\b)/i;

type Sections = { header: string[] } & Record<Section, string[]>;

export function splitSections(text: string): Sections {
  const out: Sections = { header: [], summary: [], skills: [], experience: [], education: [], certifications: [], other: [] };
  let current: Section | "header" = "header";
  for (const raw of text.split("\n")) {
    const line = joinSpacedLetters(raw);
    if (!line) continue;
    const whole = headingOf(line);
    if (whole) {
      current = whole;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0 && colon <= 30) {
      const inline = headingOf(line.slice(0, colon));
      const rest = line.slice(colon + 1).trim();
      if (inline && rest) {
        // "Languages: Java, Python" inside a skills section is a skill group, not spoken languages.
        out[current === "skills" && inline === "other" ? "skills" : inline].push(rest);
        continue;
      }
    }
    if (current === "skills" && ENTRY_START.test(line)) current = "other";
    out[current].push(line);
  }
  return out;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[") depth++;
    if ((ch === ")" || ch === "]") && depth > 0) depth--;
    if (depth === 0 && /[,;|•·▪●]/.test(ch)) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}

function unbalanced(s: string): boolean {
  return (s.match(/\(/g) ?? []).length > (s.match(/\)/g) ?? []).length;
}

/** Prose words; a skills line with two or more is a sentence (or OCR-merged columns), not a list. */
const SENTENCE_WORD = /\b(?:and|to|into|with|for|across|the|of|on|by|from|that|which|is|are|were|was|using|ensuring)\b/gi;

const PERSONAL_LABEL =
  /^(?:current )?(?:location|address|city|state|country|e-?mail|phone|mobile|contact\w*|d\.?o\.?b|date of birth|nationality|gender|sex|marital status|father'?s? name|mother'?s? name|languages? known|hobbies|interests|linkedin|github|portfolio|website|passport\w*|notice period|ctc|expected ctc|current ctc|place|date)\s*$/i;

function readSkills(lines: string[]): string[] {
  const logical: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(BULLET, "").trim();
    if (!line) continue;
    const prev = logical[logical.length - 1];
    if (prev !== undefined && (unbalanced(prev) || /,\s*$/.test(prev))) logical[logical.length - 1] = `${prev} ${line}`;
    else logical.push(line);
  }
  const skills: string[] = [];
  const seen = new Set<string>();
  for (const line of logical) {
    const colon = line.indexOf(":");
    if (colon > 0 && PERSONAL_LABEL.test(line.slice(0, colon).replace(BULLET, "").trim())) continue;
    const body = afterLabel(line);
    const parts = splitTopLevel(body);
    const outer = body.replace(/\([^)]*\)/g, " ").trim();
    const words = outer.split(/\s+/).length;
    if ((parts.length === 1 && words > 3) || words / parts.length > 4) continue;
    if ((outer.match(SENTENCE_WORD) ?? []).length >= 2) continue;
    addSkillItems(parts, seen, skills);
    if (skills.length >= MAX_SKILLS) break;
  }
  return skills;
}

function afterLabel(line: string): string {
  const colon = line.indexOf(":");
  return colon > 0 && colon <= 40 ? line.slice(colon + 1) : line;
}

function addSkillItems(parts: string[], seen: Set<string>, out: string[]): void {
  const items: string[] = [];
  for (const part of parts) {
    const grouped = part.match(/^([^()]{1,40})\(([^)]*)\)\s*$/);
    if (grouped && (part.trim().length > 40 || grouped[2].includes(","))) items.push(grouped[1], ...grouped[2].split(","));
    else items.push(part);
  }
  for (const part of items) {
    const item = part
      .replace(BULLET, "")
      .replace(/^(?:and|or)\s+/i, "")
      .replace(/[.\s]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!item || item.length > 40 || !/[A-Za-z]/.test(item) || /^\d/.test(item)) continue;
    if (item.split(" ").length > 4 || /:$/.test(item) || /[—|]/.test(item)) continue;
    if (/^[a-z]/.test(item) && item.includes(" ")) continue;
    if (/^[a-z]+$/.test(item) && !KNOWN_LOWER.has(item)) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_SKILLS) return;
  }
}

/** Cleans a skill list from any source: drops category labels, splits grouped entries, dedupes. */
export function normalizeSkillList(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    addSkillItems(splitTopLevel(afterLabel(raw)), seen, out);
    if (out.length >= MAX_SKILLS) break;
  }
  return out;
}

const KNOWN_SKILLS = [
  "Java", "Python", "JavaScript", "TypeScript", "C++", "C#", "Golang", "Kotlin", "Swift", "PHP", "Ruby", "Scala", "Rust",
  "Dart", "SQL", "PL/SQL", "MySQL", "PostgreSQL", "Oracle", "MongoDB", "Redis", "SQL Server", "Cassandra", "Elasticsearch",
  "HTML", "CSS", "Sass", "Tailwind", "Bootstrap", "React", "React.js", "React Native", "Angular", "Vue.js", "Next.js", "Node.js",
  "Express", "Express.js", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Hibernate", ".NET", "ASP.NET", "Laravel",
  "Flutter", "Android", "iOS", "Redux", "GraphQL", "REST", "REST APIs", "Microservices", "Kafka", "RabbitMQ",
  "AWS", "Azure", "GCP", "Google Cloud", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "GitHub Actions", "GitLab CI",
  "CI/CD", "Linux", "Unix", "Bash", "Shell Scripting", "PowerShell", "Git", "GitHub", "GitLab", "Bitbucket", "Jira", "Confluence",
  "Maven", "Gradle", "Nginx", "Apache", "Prometheus", "Grafana", "SonarQube", "Nexus", "Selenium", "Cypress", "Playwright",
  "JUnit", "TestNG", "Jest", "Postman", "JMeter", "Appium", "Cucumber", "Manual Testing", "Automation Testing", "API Testing",
  "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "TensorFlow", "PyTorch", "Keras", "scikit-learn", "Pandas",
  "NumPy", "Matplotlib", "OpenCV", "Power BI", "Tableau", "Excel", "Advanced Excel", "Data Analysis", "Data Science", "Spark",
  "Hadoop", "Snowflake", "Databricks", "Airflow", "ETL", "SAP", "Salesforce", "ServiceNow", "Figma", "Adobe XD", "Photoshop",
  "Illustrator", "Sketch", "UI/UX", "Agile", "Scrum", "Kanban", "SDLC", "STLC", "OOP", "Data Structures", "Algorithms",
  "Recruitment", "Talent Acquisition", "Sourcing", "Bench Sales", "US IT Recruitment", "Payroll", "Onboarding", "Tally", "GST",
];

const KNOWN_LOWER = new Set(KNOWN_SKILLS.map((s) => s.toLowerCase()).concat(["npm", "yarn", "kubectl", "helm", "vim"]));

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function scanKnownSkills(text: string): string[] {
  const found: string[] = [];
  for (const skill of KNOWN_SKILLS) {
    const re = new RegExp(`(^|[^A-Za-z0-9+#.])${escapeRe(skill)}(?![A-Za-z0-9+#])`);
    if (re.test(text)) found.push(skill);
    if (found.length >= MAX_SKILLS) break;
  }
  return found;
}

const DEGREE_WORD =
  /\b(?:b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|m\.?\s?com|bca|mca|bba|mba|pgdm|b\.?\s?pharm|m\.?\s?pharm|ph\.?\s?d|llb|mbbs|bachelor\w*|master\w*|diploma|intermediate|ssc|hsc|10th|12th|matriculation|higher secondary|secondary school|post[- ]?graduat\w*|graduat\w*)\b/i;
const DEGREE_SHORT = /\b(?:B\.E|M\.E|B\.A|M\.A|BE|ME)\b/;
const DEGREE = { test: (s: string) => DEGREE_WORD.test(s) || DEGREE_SHORT.test(s) };
const INSTITUTION =
  /\b(?:college|colleges|university|institute|institution|school|academy|vidyalaya|vidyalayam|polytechnic|iit|nit|iiit|bits|campus)\b/i;
const YEAR_RANGE = /\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present\w*|current\w*|pursuing)\b/i;
const YEAR = /\b(?:19[6-9]\d|20\d{2})\b/g;
const SCORE = /\b(?:c?gpa|cpi|percentage|marks|score|grade)\b.*$|\b\d{1,3}(?:\.\d+)?\s*%/gi;

function yearOf(line: string): string {
  const range = line.match(YEAR_RANGE);
  if (range) return `${range[1]} – ${range[2].replace(/^./, (c) => c.toUpperCase())}`;
  const years = line.match(YEAR);
  return years ? years[years.length - 1] : "";
}

function stripNoise(s: string): string {
  return s
    .replace(SCORE, "")
    .replace(YEAR_RANGE, "")
    .replace(YEAR, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,|–—:-]+|[\s,|–—:(-]+$/g, "")
    .trim()
    .slice(0, 150);
}

function readEducation(lines: string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];
  let current: EducationEntry | null = null;
  const push = (e: EducationEntry) => {
    current = e;
    entries.push(e);
  };
  for (const raw of lines) {
    const line = raw.replace(BULLET, "").trim();
    if (!line) continue;
    const year = yearOf(line);
    const parts = line
      .split(/\s[|–—-]\s|,|\s(?:at|from)\s/i)
      .map((p) => stripNoise(p))
      .filter((p) => /[A-Za-z]/.test(p));
    const degreePart = parts.find((p) => DEGREE.test(p));
    const instPart = parts.find((p) => p !== degreePart && INSTITUTION.test(p));
    const cur = current as EducationEntry | null;
    if (degreePart) {
      const institution =
        instPart ?? parts.find((p) => p !== degreePart && /^[A-Z]/.test(p) && p.split(" ").length >= 2) ?? "";
      const degree = institution ? degreePart : stripNoise(line);
      if (cur && !cur.degree) {
        cur.degree = degree;
        if (!cur.institution && institution) cur.institution = institution;
        if (!cur.year && year) cur.year = year;
      } else {
        push({ degree, institution, year });
      }
    } else if (instPart || (parts.length > 0 && INSTITUTION.test(line))) {
      const institution = instPart ?? stripNoise(line);
      if (cur && !cur.institution) {
        cur.institution = institution;
        if (!cur.year && year) cur.year = year;
      } else {
        push({ degree: "", institution, year });
      }
    } else if (year && cur && !cur.year) {
      cur.year = year;
    }
    if (entries.length >= MAX_EDUCATION) break;
  }
  return entries.filter((e) => e.degree || e.institution);
}

function readCertifications(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.replace(BULLET, "").replace(/\s+/g, " ").trim().slice(0, 150);
    if (line.length < 3 || !/[A-Za-z]/.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= MAX_CERTIFICATIONS) break;
  }
  return out;
}

function joinParagraph(lines: string[]): string {
  let text = "";
  for (const raw of lines) {
    const line = raw.replace(BULLET, "").trim();
    if (!line) continue;
    if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(line)) text = text.slice(0, -1) + line;
    else text = text ? `${text} ${line}` : line;
  }
  return text.replace(/\s+/g, " ").trim();
}

function readSummary(sections: Sections): string {
  let text = joinParagraph(sections.summary);
  if (!text) {
    const long: string[] = [];
    for (const line of sections.header) {
      if (line.length >= 60 && !/@|\d{6,}/.test(line)) long.push(line);
      else if (long.length > 0) break;
    }
    text = joinParagraph(long);
  }
  if (text.length < 60) return "";
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : text;
}

function readLinkedIn(text: string): string {
  const m = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]{3,100})/i);
  return m ? `https://www.linkedin.com/in/${m[1]}` : "";
}

const CITIES = [
  "Hyderabad", "Secunderabad", "Bangalore", "Bengaluru", "Chennai", "Mumbai", "Navi Mumbai", "Pune", "Delhi", "New Delhi", "Noida",
  "Greater Noida", "Gurgaon", "Gurugram", "Ghaziabad", "Faridabad", "Kolkata", "Ahmedabad", "Vadodara", "Surat", "Jaipur", "Lucknow",
  "Kanpur", "Indore", "Bhopal", "Nagpur", "Nashik", "Chandigarh", "Mohali", "Kochi", "Cochin", "Thiruvananthapuram", "Trivandrum",
  "Coimbatore", "Madurai", "Tiruchirappalli", "Mysore", "Mysuru", "Mangalore", "Vijayawada", "Visakhapatnam", "Vizag", "Guntur",
  "Nellore", "Tirupati", "Kakinada", "Rajahmundry", "Warangal", "Karimnagar", "Khammam", "Nizamabad", "Kurnool", "Anantapur",
  "Bhubaneswar", "Patna", "Ranchi", "Raipur", "Guwahati", "Dehradun", "Goa", "Panaji",
  "Dallas", "Austin", "Houston", "New York", "New Jersey", "Chicago", "Atlanta", "Seattle", "San Jose", "San Francisco",
  "Boston", "Charlotte", "Phoenix", "Toronto", "London", "Dubai", "Singapore", "Sydney", "Melbourne",
];
const CITY_RE = new RegExp(`\\b(?:${CITIES.map(escapeRe).join("|")})\\b`, "i");

function cleanPlace(value: string): string {
  const parts = value
    .replace(/\b\d{5,6}\b/g, "")
    .split(",")
    .map((p) => p.replace(/[^A-Za-z\u00C0-\u024F .'-]/g, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 2);
  const cityAt = parts.findIndex((p) => CITY_RE.test(p));
  const picked = cityAt >= 0 ? parts.slice(cityAt, cityAt + 2) : parts.slice(-2);
  return picked.join(", ").slice(0, 80);
}

function readLocation(sections: Sections, text: string): string {
  const label = text.match(
    /(?:^|\n)[ \t]*(?:current[ \t]+)?(?:location|city|residence|based[ \t]+in|(?:present[ \t]+|current[ \t]+)?address)[ \t]*[:\-–][ \t]*([^\n]{2,120})/i,
  );
  if (label) {
    const place = cleanPlace(label[1]);
    if (place) return place;
  }
  for (const line of sections.header.slice(0, 10)) {
    if (line.length > 140) continue;
    for (const seg of line.split(/\s[|•·—–]\s|\t|\s{2,}|\|/)) {
      const s = seg.trim();
      if (s.length <= 60 && !/[@\d]/.test(s) && CITY_RE.test(s)) return cleanPlace(s);
    }
  }
  return "";
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const DATE = `(?:${MON}[\\s,'’-]*(?:(?:19|20)\\d{2}|['’]\\d{2})|\\d{1,2}\\s*[/.-]\\s*(?:19|20)\\d{2}|(?:19|20)\\d{2})(?!\\d)`;
const RANGE_RE = new RegExp(
  `(${DATE})\\s*(?:-|–|—|to|till|until)\\s*(${DATE}|presen\\w*|current\\w*|now|till date|to date|today|ongoing)`,
  "gi",
);

function monthIndex(raw: string, now: Date): number | null {
  const s = raw.toLowerCase().trim();
  if (/^(presen|current|now|till date|to date|today|ongoing)/.test(s)) return now.getFullYear() * 12 + now.getMonth();
  const named = s.match(/^([a-z]{3})[a-z]*\.?[\s,'’-]*((?:19|20)\d{2}|\d{2})$/);
  if (named && named[1] in MONTHS) {
    const y = named[2].length === 2 ? 2000 + Number(named[2]) : Number(named[2]);
    return y * 12 + MONTHS[named[1]];
  }
  const numeric = s.match(/^(\d{1,2})\s*[/.-]\s*((?:19|20)\d{2})$/);
  if (numeric && Number(numeric[1]) >= 1 && Number(numeric[1]) <= 12) return Number(numeric[2]) * 12 + Number(numeric[1]) - 1;
  const year = s.match(/^((?:19|20)\d{2})$/);
  return year ? Number(year[1]) * 12 : null;
}

function readWorkYears(lines: string[], now: Date): number | null {
  const nowIndex = now.getFullYear() * 12 + now.getMonth();
  const spans: Array<[number, number]> = [];
  lines.forEach((line, i) => {
    const context = `${lines[i - 1] ?? ""} ${line}`;
    if (/\bintern(?:ship)?s?\b|\btrainee\b/i.test(context)) return;
    for (const m of Array.from(line.matchAll(RANGE_RE))) {
      const start = monthIndex(m[1], now);
      const end = monthIndex(m[2], now);
      if (start === null || end === null) continue;
      const s = start;
      const e = Math.min(end, nowIndex);
      if (s < 1970 * 12 || s > nowIndex || e <= s || e - s > 50 * 12) continue;
      spans.push([s, e]);
    }
  });
  if (spans.length === 0) return null;
  spans.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let [curStart, curEnd] = spans[0];
  for (let i = 1; i < spans.length; i++) {
    const [s, e] = spans[i];
    if (s <= curEnd) curEnd = Math.max(curEnd, e);
    else {
      months += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  months += curEnd - curStart;
  return months > 0 ? Math.round((months / 12) * 10) / 10 : null;
}

export function extractResumeProfile(text: string, now: Date = new Date()): ResumeProfile {
  const sections = splitSections(text);
  const skills = sections.skills.length > 0 ? readSkills(sections.skills) : [];
  return {
    location: readLocation(sections, text),
    linkedIn: readLinkedIn(text),
    summary: readSummary(sections),
    skills: skills.length > 0 ? skills : scanKnownSkills(text),
    education: readEducation(sections.education),
    certifications: readCertifications(sections.certifications),
    experienceYears: readWorkYears(sections.experience, now),
  };
}
