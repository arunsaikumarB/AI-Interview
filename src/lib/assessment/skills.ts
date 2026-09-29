/**
 * Skill vocabulary used to normalise JD and resume mentions.
 *
 * Deterministic and intentionally finite: a term outside this list is kept
 * verbatim when the recruiter typed it into the job's skills / must-have
 * fields, and otherwise simply not detected. Aliases prefixed with "=" match
 * case-sensitively (short or ambiguous words such as "Go").
 */

export type SkillCategory =
  | "LANGUAGE"
  | "FRONTEND"
  | "BACKEND"
  | "MOBILE"
  | "DATA"
  | "ML"
  | "DATA_ENG"
  | "CLOUD"
  | "DEVOPS"
  | "DATABASE"
  | "TESTING"
  | "SECURITY"
  | "DESIGN"
  | "PRODUCT"
  | "PROJECT"
  | "ANALYSIS"
  | "SUPPORT"
  | "WRITING"
  | "ARCHITECTURE"
  | "PRACTICE";

type SkillDef = { name: string; category: SkillCategory; aliases: string[] };

const RAW: [string, SkillCategory, ...string[]][] = [
  // Languages
  ["JavaScript", "LANGUAGE", "javascript", "=JS", "ecmascript", "es6"],
  ["TypeScript", "LANGUAGE", "typescript", "=TS"],
  ["Python", "LANGUAGE", "python"],
  ["Java", "LANGUAGE", "java"],
  ["C#", "LANGUAGE", "c#", "csharp"],
  ["C++", "LANGUAGE", "c++", "cpp"],
  ["Go", "LANGUAGE", "golang", "=Go"],
  ["Rust", "LANGUAGE", "rust"],
  ["Ruby", "LANGUAGE", "ruby"],
  ["PHP", "LANGUAGE", "php"],
  ["Kotlin", "LANGUAGE", "kotlin"],
  ["Swift", "LANGUAGE", "swift", "swiftui"],
  ["Scala", "LANGUAGE", "scala"],
  ["Bash", "LANGUAGE", "bash", "shell scripting", "powershell"],
  ["R", "LANGUAGE", "r programming", "rstudio"],
  // Frontend
  ["React", "FRONTEND", "react", "react.js", "reactjs"],
  ["Next.js", "FRONTEND", "next.js", "nextjs"],
  ["Angular", "FRONTEND", "angular", "angularjs"],
  ["Vue", "FRONTEND", "vue", "vue.js", "vuejs", "nuxt"],
  ["HTML", "FRONTEND", "html", "html5"],
  ["CSS", "FRONTEND", "css", "css3", "sass", "scss", "tailwind", "tailwindcss"],
  ["Redux", "FRONTEND", "redux", "zustand", "mobx"],
  ["Web accessibility", "FRONTEND", "accessibility", "wcag", "a11y"],
  ["Frontend performance", "FRONTEND", "web performance", "core web vitals", "lighthouse"],
  // Backend
  ["Node.js", "BACKEND", "node.js", "nodejs", "node"],
  ["Express", "BACKEND", "express.js", "expressjs"],
  ["NestJS", "BACKEND", "nestjs"],
  ["Django", "BACKEND", "django"],
  ["Flask", "BACKEND", "flask"],
  ["FastAPI", "BACKEND", "fastapi"],
  ["Spring Boot", "BACKEND", "spring boot", "spring framework", "springboot"],
  [".NET", "BACKEND", ".net", "asp.net", "dotnet", ".net core"],
  ["Ruby on Rails", "BACKEND", "rails", "ruby on rails"],
  ["REST APIs", "BACKEND", "=REST", "restful", "rest api", "rest apis"],
  ["GraphQL", "BACKEND", "graphql"],
  ["gRPC", "BACKEND", "grpc"],
  ["Microservices", "ARCHITECTURE", "microservices", "microservice"],
  ["Message queues", "BACKEND", "kafka", "rabbitmq", "sqs", "message queue", "message queues", "pub/sub"],
  ["Caching", "BACKEND", "redis", "memcached", "caching"],
  // Mobile
  ["iOS", "MOBILE", "ios"],
  ["Android", "MOBILE", "android"],
  ["React Native", "MOBILE", "react native"],
  ["Flutter", "MOBILE", "flutter", "dart"],
  // Databases
  ["SQL", "DATABASE", "sql", "t-sql", "pl/sql", "plsql"],
  ["PostgreSQL", "DATABASE", "postgresql", "postgres"],
  ["MySQL", "DATABASE", "mysql", "mariadb"],
  ["SQL Server", "DATABASE", "sql server", "mssql"],
  ["Oracle Database", "DATABASE", "oracle database", "oracle db"],
  ["MongoDB", "DATABASE", "mongodb", "mongo"],
  ["NoSQL", "DATABASE", "nosql", "dynamodb", "cassandra"],
  ["Database performance tuning", "DATABASE", "query optimization", "query tuning", "indexing", "performance tuning"],
  ["Data modeling", "DATABASE", "data modeling", "data modelling", "schema design"],
  // Data / analytics
  ["Excel", "DATA", "excel", "spreadsheets"],
  ["Power BI", "DATA", "power bi", "powerbi"],
  ["Tableau", "DATA", "tableau"],
  ["Looker", "DATA", "looker"],
  ["Data visualization", "DATA", "data visualization", "data visualisation", "dashboards", "dashboarding"],
  ["Statistics", "DATA", "statistics", "statistical analysis", "hypothesis testing", "a/b testing"],
  ["Pandas", "DATA", "pandas", "numpy"],
  // ML
  ["Machine learning", "ML", "machine learning", "=ML"],
  ["Deep learning", "ML", "deep learning", "neural networks"],
  ["PyTorch", "ML", "pytorch"],
  ["TensorFlow", "ML", "tensorflow", "keras"],
  ["scikit-learn", "ML", "scikit-learn", "sklearn"],
  ["NLP", "ML", "=NLP", "natural language processing"],
  ["Computer vision", "ML", "computer vision", "opencv"],
  ["LLMs", "ML", "=LLM", "=LLMs", "large language models", "generative ai", "genai"],
  ["MLOps", "ML", "mlops", "mlflow", "model deployment"],
  ["Feature engineering", "ML", "feature engineering"],
  // Data engineering
  ["ETL", "DATA_ENG", "=ETL", "=ELT", "etl pipelines", "data pipelines", "data pipeline"],
  ["Apache Spark", "DATA_ENG", "spark", "pyspark"],
  ["Airflow", "DATA_ENG", "airflow"],
  ["dbt", "DATA_ENG", "=dbt"],
  ["Data warehousing", "DATA_ENG", "data warehouse", "data warehousing", "snowflake", "bigquery", "redshift"],
  ["Hadoop", "DATA_ENG", "hadoop", "hive"],
  ["Streaming", "DATA_ENG", "stream processing", "flink", "kinesis"],
  // Cloud / DevOps / SRE
  ["AWS", "CLOUD", "=AWS", "amazon web services", "ec2", "lambda", "s3"],
  ["Azure", "CLOUD", "azure"],
  ["GCP", "CLOUD", "=GCP", "google cloud"],
  ["Docker", "DEVOPS", "docker", "containers", "containerization"],
  ["Kubernetes", "DEVOPS", "kubernetes", "k8s", "helm"],
  ["Terraform", "DEVOPS", "terraform", "infrastructure as code", "=IaC", "cloudformation", "pulumi"],
  ["Ansible", "DEVOPS", "ansible", "chef", "puppet"],
  ["CI/CD", "DEVOPS", "ci/cd", "continuous integration", "continuous delivery", "continuous deployment", "jenkins", "github actions", "gitlab ci"],
  ["Linux", "DEVOPS", "linux", "unix"],
  ["Networking", "DEVOPS", "networking", "tcp/ip", "=DNS", "load balancing", "load balancers"],
  ["Observability", "DEVOPS", "observability", "monitoring", "prometheus", "grafana", "datadog", "alerting", "logging"],
  ["Incident management", "DEVOPS", "incident management", "incident response", "on-call", "postmortems", "post-mortems"],
  ["SLOs", "DEVOPS", "=SLO", "=SLOs", "=SLI", "=SLIs", "error budgets", "service level objectives"],
  ["Git", "PRACTICE", "git", "version control"],
  // QA
  ["Test automation", "TESTING", "test automation", "automated testing", "automation testing"],
  ["Selenium", "TESTING", "selenium", "webdriver"],
  ["Cypress", "TESTING", "cypress", "playwright"],
  ["Unit testing", "TESTING", "unit testing", "unit tests", "jest", "pytest", "junit", "=TDD"],
  ["API testing", "TESTING", "api testing", "postman"],
  ["Performance testing", "TESTING", "performance testing", "load testing", "jmeter", "k6"],
  ["Manual testing", "TESTING", "manual testing", "test cases", "test plans", "regression testing"],
  // Security
  ["Application security", "SECURITY", "application security", "appsec", "owasp", "secure coding"],
  ["Network security", "SECURITY", "network security", "firewalls", "=IDS", "=IPS"],
  ["Penetration testing", "SECURITY", "penetration testing", "pentesting", "pen testing", "burp suite"],
  ["SIEM", "SECURITY", "=SIEM", "splunk", "security monitoring", "security operations center"],
  ["Identity and access management", "SECURITY", "=IAM", "identity and access management", "oauth", "=SSO", "=RBAC"],
  ["Threat modeling", "SECURITY", "threat modeling", "threat modelling"],
  ["Vulnerability management", "SECURITY", "vulnerability management", "vulnerability scanning", "=CVE"],
  ["Security compliance", "SECURITY", "iso 27001", "soc 2", "=SOC2", "pci dss", "=GDPR", "=HIPAA"],
  // Design
  ["Figma", "DESIGN", "figma", "sketch", "adobe xd"],
  ["User research", "DESIGN", "user research", "usability testing", "user interviews"],
  ["Wireframing", "DESIGN", "wireframing", "wireframes", "prototyping", "prototypes"],
  ["Interaction design", "DESIGN", "interaction design", "user flows", "information architecture"],
  ["Visual design", "DESIGN", "visual design", "typography", "ui design"],
  ["Design systems", "DESIGN", "design system", "design systems"],
  // Product / project / BA
  ["Product strategy", "PRODUCT", "product strategy", "product vision", "roadmap", "roadmaps", "roadmapping"],
  ["Prioritization", "PRODUCT", "prioritization", "prioritisation", "backlog management"],
  ["Product analytics", "PRODUCT", "product analytics", "=KPI", "=KPIs", "product metrics", "=OKR", "=OKRs"],
  ["Go-to-market", "PRODUCT", "go-to-market", "=GTM"],
  ["Agile", "PROJECT", "agile", "scrum", "kanban", "sprint planning"],
  ["Jira", "PROJECT", "jira", "confluence"],
  ["Risk management", "PROJECT", "risk management", "risk mitigation"],
  ["Budgeting", "PROJECT", "budgeting", "budget management", "cost management"],
  ["Stakeholder management", "PROJECT", "stakeholder management", "stakeholders"],
  ["Project planning", "PROJECT", "project planning", "project schedules", "gantt", "=PMP", "=PRINCE2"],
  ["Requirements gathering", "ANALYSIS", "requirements gathering", "requirements elicitation", "requirements analysis", "user stories", "acceptance criteria"],
  ["Process modeling", "ANALYSIS", "process modeling", "process mapping", "=BPMN", "=UML"],
  ["Gap analysis", "ANALYSIS", "gap analysis", "business process"],
  // Support / writing / architecture
  ["Troubleshooting", "SUPPORT", "troubleshooting", "root cause analysis", "debugging"],
  ["Ticketing systems", "SUPPORT", "ticketing", "zendesk", "servicenow", "freshdesk"],
  ["ITIL", "SUPPORT", "=ITIL"],
  ["Active Directory", "SUPPORT", "active directory"],
  ["Technical writing", "WRITING", "technical writing", "technical documentation", "documentation"],
  ["API documentation", "WRITING", "api documentation", "openapi", "swagger"],
  ["Docs-as-code", "WRITING", "docs-as-code", "markdown", "static site generators"],
  ["System design", "ARCHITECTURE", "system design", "distributed systems", "scalability", "high availability"],
  ["Solution architecture", "ARCHITECTURE", "solution architecture", "enterprise architecture", "architecture design", "=TOGAF"],
  ["Integration patterns", "ARCHITECTURE", "integration patterns", "enterprise integration", "=ESB"],
];

const DEFS: SkillDef[] = RAW.map(([name, category, ...aliases]) => ({
  name,
  category,
  aliases,
}));

const BY_NAME = new Map(DEFS.map((d) => [d.name.toLowerCase(), d]));

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Word-ish boundaries that also respect "+", "#" and "." inside skill names. */
function aliasRegex(alias: string): RegExp {
  const caseSensitive = alias.startsWith("=");
  const term = caseSensitive ? alias.slice(1) : alias;
  return new RegExp(
    `(?<![A-Za-z0-9+#.])${escapeRegExp(term)}(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`,
    caseSensitive ? "" : "i",
  );
}

const COMPILED = DEFS.map((d) => ({
  def: d,
  regexes: [d.name, ...d.aliases].map((a) =>
    a.startsWith("=") ? aliasRegex(a) : aliasRegex(a.toLowerCase()),
  ),
}));

/** Canonical skills mentioned in a piece of text. */
export function detectSkills(text: string): { name: string; category: SkillCategory }[] {
  if (!text) return [];
  const found: { name: string; category: SkillCategory }[] = [];
  for (const { def, regexes } of COMPILED) {
    // Very short canonical names ("R", "Go", "C#") only match through their aliases.
    const hit = regexes.some((re, i) => !(i === 0 && def.name.length <= 2) && re.test(text));
    if (hit) found.push({ name: def.name, category: def.category });
  }
  const names = new Set(found.map((f) => f.name));
  return found.filter((f) => {
    if (f.name === "React" && names.has("React Native")) {
      return /\breact(?!\s+native)\b/i.test(text);
    }
    return true;
  });
}

export function lookupSkill(name: string): SkillDef | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/** Regexes that match a competency name or any of its vocabulary aliases. */
export function matchersFor(name: string, extra: string[] = []): RegExp[] {
  const def = lookupSkill(name);
  const terms = def ? [def.name, ...def.aliases] : [name];
  return [...terms, ...extra].map((t) =>
    t.startsWith("=") ? aliasRegex(t) : aliasRegex(t.toLowerCase()),
  );
}

export const TECHNICAL_SKILL_CATEGORIES: ReadonlySet<SkillCategory> = new Set<SkillCategory>([
  "LANGUAGE",
  "FRONTEND",
  "BACKEND",
  "MOBILE",
  "DATA",
  "ML",
  "DATA_ENG",
  "CLOUD",
  "DEVOPS",
  "DATABASE",
  "TESTING",
  "SECURITY",
  "ARCHITECTURE",
]);
