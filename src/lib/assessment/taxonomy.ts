import type {
  CompetencyCategory,
  ConcreteRoleFamily,
  Importance,
  PracticalType,
} from "./types";

/**
 * Extensible role taxonomy. Adding a family = adding one entry here.
 * Signals are deliberately conservative; a JD that matches nothing strongly
 * is classified UNKNOWN rather than forced into a family.
 */

export type StandardCompetency = {
  name: string;
  category: CompetencyCategory;
  importance: Importance;
  description: string;
  /** Extra resume phrases that evidence this competency beyond the skill vocabulary. */
  resumeSignals?: string[];
};

export type PracticalTemplate = {
  type: PracticalType;
  title: string;
  competency: string;
  reason: string;
  expectedEvidence: string[];
};

export type FamilyDef = {
  label: string;
  technical: boolean;
  titleSignals: RegExp;
  skillSignals: string[];
  keywordSignals: RegExp;
  standard: StandardCompetency[];
  practical: PracticalTemplate;
};

export const ROLE_TAXONOMY: Record<ConcreteRoleFamily, FamilyDef> = {
  FRONTEND_ENGINEERING: {
    label: "Frontend Engineering",
    technical: true,
    titleSignals: /\b(front[- ]?end|ui (?:engineer|developer)|react (?:developer|engineer)|angular (?:developer|engineer)|vue (?:developer|engineer)|web developer)\b/i,
    skillSignals: ["JavaScript", "TypeScript", "React", "Next.js", "Angular", "Vue", "HTML", "CSS", "Redux", "Web accessibility", "Frontend performance"],
    keywordSignals: /\b(user interfaces?|responsive|browser|component library|single[- ]page|web app)\b/i,
    standard: [
      { name: "UI component architecture", category: "TECHNICAL", importance: "HIGH", description: "Structuring reusable, testable UI components and state.", resumeSignals: ["components", "component library"] },
      { name: "Web accessibility", category: "TECHNICAL", importance: "MEDIUM", description: "Building interfaces usable with assistive technology." },
      { name: "Frontend performance", category: "TECHNICAL", importance: "MEDIUM", description: "Diagnosing and improving load and render performance." },
    ],
    practical: {
      type: "UI_COMPONENT_EXERCISE",
      title: "Build or extend a UI component",
      competency: "UI component architecture",
      reason: "Frontend work is best evidenced by building a small, accessible component with real state.",
      expectedEvidence: ["Working component meeting the brief", "Sensible state management", "Accessibility basics (labels, keyboard)", "Explanation of trade-offs"],
    },
  },
  BACKEND_ENGINEERING: {
    label: "Backend Engineering",
    technical: true,
    titleSignals: /\b(back[- ]?end|server[- ]side|api (?:developer|engineer)|(?:java|python|node(?:\.js)?|golang|go|\.net|c#|ruby|php) (?:developer|engineer))\b/i,
    skillSignals: ["Node.js", "Express", "NestJS", "Django", "Flask", "FastAPI", "Spring Boot", ".NET", "Ruby on Rails", "REST APIs", "GraphQL", "gRPC", "Microservices", "Message queues", "Caching", "Java", "Go", "C#", "PostgreSQL", "SQL"],
    keywordSignals: /\b(apis?|services?|server|backend|endpoints?|throughput|latency)\b/i,
    standard: [
      { name: "API design", category: "TECHNICAL", importance: "HIGH", description: "Designing clear, versionable, secure service interfaces.", resumeSignals: ["api", "apis", "endpoints"] },
      { name: "Data access and persistence", category: "TECHNICAL", importance: "HIGH", description: "Modelling data and using databases correctly and efficiently.", resumeSignals: ["database", "sql", "orm"] },
      { name: "Reliability and error handling", category: "TECHNICAL", importance: "MEDIUM", description: "Handling failures, retries, idempotency and observability.", resumeSignals: ["reliability", "error handling", "monitoring"] },
    ],
    practical: {
      type: "API_DESIGN_EXERCISE",
      title: "Design and implement a small API endpoint",
      competency: "API design",
      reason: "Backend roles are evidenced by designing an endpoint, its data model and failure handling.",
      expectedEvidence: ["Clear request/response contract", "Validation and error handling", "Reasonable data model", "Testing approach"],
    },
  },
  FULLSTACK_ENGINEERING: {
    label: "Full-stack Engineering",
    technical: true,
    titleSignals: /\b(full[- ]?stack)\b/i,
    skillSignals: [],
    keywordSignals: /\b(end[- ]to[- ]end|full[- ]?stack|frontend and backend|front[- ]end and back[- ]end)\b/i,
    standard: [
      { name: "API design", category: "TECHNICAL", importance: "HIGH", description: "Designing the service contract the UI depends on.", resumeSignals: ["api", "apis"] },
      { name: "UI component architecture", category: "TECHNICAL", importance: "HIGH", description: "Building maintainable UI on top of those services.", resumeSignals: ["components"] },
      { name: "End-to-end feature delivery", category: "PRACTICE", importance: "MEDIUM", description: "Taking a feature from schema to UI to deployment.", resumeSignals: ["end-to-end", "full stack", "full-stack"] },
    ],
    practical: {
      type: "CODING_EXERCISE",
      title: "Small end-to-end feature",
      competency: "End-to-end feature delivery",
      reason: "Full-stack roles are evidenced by connecting a UI change to an API and data change.",
      expectedEvidence: ["Working UI and API path", "Consistent data contract", "Error states handled", "Explanation of trade-offs"],
    },
  },
  MOBILE_ENGINEERING: {
    label: "Mobile Engineering",
    technical: true,
    titleSignals: /\b(mobile|ios|android|flutter|react native)\b.*\b(developer|engineer)\b|\b(mobile|ios|android) (?:developer|engineer)\b/i,
    skillSignals: ["iOS", "Android", "React Native", "Flutter", "Swift", "Kotlin"],
    keywordSignals: /\b(mobile app|app store|play store|offline sync|push notifications)\b/i,
    standard: [
      { name: "Mobile app architecture", category: "TECHNICAL", importance: "HIGH", description: "Structuring app state, navigation and lifecycle.", resumeSignals: ["mobile app", "app"] },
      { name: "Mobile performance and offline behaviour", category: "TECHNICAL", importance: "MEDIUM", description: "Handling constrained devices, networks and offline states." },
      { name: "App release process", category: "PRACTICE", importance: "LOW", description: "Store submission, versioning and staged rollout.", resumeSignals: ["app store", "play store"] },
    ],
    practical: {
      type: "CODING_EXERCISE",
      title: "Mobile screen with state and offline handling",
      competency: "Mobile app architecture",
      reason: "Mobile work is evidenced by a screen that handles lifecycle and network variability.",
      expectedEvidence: ["Working screen", "State survives lifecycle events", "Loading/offline states", "Explanation of trade-offs"],
    },
  },
  DATA_ANALYTICS: {
    label: "Data Analytics",
    technical: true,
    titleSignals: /\b(data analyst|business intelligence|bi (?:analyst|developer|engineer)|analytics (?:analyst|engineer)|reporting analyst|insights analyst)\b/i,
    skillSignals: ["SQL", "Excel", "Power BI", "Tableau", "Looker", "Data visualization", "Statistics", "Python", "Pandas"],
    keywordSignals: /\b(dashboards?|reports?|insights|kpis?|business questions?|ad[- ]hoc analysis)\b/i,
    standard: [
      { name: "SQL analysis", category: "TECHNICAL", importance: "HIGH", description: "Writing correct analytical queries (joins, aggregation, windows).", resumeSignals: ["sql", "queries"] },
      { name: "Data interpretation", category: "PRACTICE", importance: "HIGH", description: "Turning data into correct, caveated conclusions.", resumeSignals: ["insights", "analysis"] },
      { name: "Data visualization", category: "TECHNICAL", importance: "MEDIUM", description: "Choosing visuals that communicate honestly." },
    ],
    practical: {
      type: "SQL_ANALYSIS",
      title: "SQL + interpretation case",
      competency: "SQL analysis",
      reason: "Analyst roles are evidenced by querying a dataset and explaining what the result does and does not show.",
      expectedEvidence: ["Correct queries", "Handling of nulls/duplicates", "Clear conclusion with caveats", "Appropriate visual or summary"],
    },
  },
  DATA_SCIENCE: {
    label: "Data Science",
    technical: true,
    titleSignals: /\b(data scientist|data science)\b/i,
    skillSignals: ["Python", "Statistics", "Machine learning", "Pandas", "scikit-learn", "SQL", "R", "Feature engineering"],
    keywordSignals: /\b(experiments?|hypothes[ie]s|predictive|modell?ing|statistical)\b/i,
    standard: [
      { name: "Statistics", category: "TECHNICAL", importance: "HIGH", description: "Sound statistical reasoning, experimentation and inference." },
      { name: "Model evaluation", category: "TECHNICAL", importance: "HIGH", description: "Choosing metrics and validation that reflect the real problem.", resumeSignals: ["model", "validation", "accuracy"] },
      { name: "Problem framing", category: "PRACTICE", importance: "MEDIUM", description: "Translating business questions into analytical problems." },
    ],
    practical: {
      type: "ML_CASE_STUDY",
      title: "Modelling case study",
      competency: "Model evaluation",
      reason: "Data science is evidenced by framing a problem, choosing an approach and validating it honestly.",
      expectedEvidence: ["Clear problem framing", "Appropriate baseline", "Correct validation strategy", "Discussion of limitations"],
    },
  },
  MACHINE_LEARNING: {
    label: "Machine Learning Engineering",
    technical: true,
    titleSignals: /\b(machine learning|ml engineer|mlops|ai engineer|deep learning|nlp engineer|computer vision engineer|applied scientist)\b/i,
    skillSignals: ["Machine learning", "Deep learning", "PyTorch", "TensorFlow", "scikit-learn", "NLP", "Computer vision", "LLMs", "MLOps", "Python"],
    keywordSignals: /\b(models?|training|inference|embeddings?|fine[- ]tun|model serving)\b/i,
    standard: [
      { name: "Model development", category: "TECHNICAL", importance: "HIGH", description: "Training, tuning and debugging models.", resumeSignals: ["model", "trained", "training"] },
      { name: "Model deployment and monitoring", category: "TECHNICAL", importance: "HIGH", description: "Serving models and detecting drift or degradation.", resumeSignals: ["deployed", "inference", "serving"] },
      { name: "Model evaluation", category: "TECHNICAL", importance: "MEDIUM", description: "Offline/online evaluation that matches the product goal." },
    ],
    practical: {
      type: "ML_CASE_STUDY",
      title: "ML system design case",
      competency: "Model deployment and monitoring",
      reason: "ML engineering is evidenced by designing training, serving and monitoring for a concrete use case.",
      expectedEvidence: ["Data and feature plan", "Model choice with justification", "Serving and latency considerations", "Monitoring and retraining plan"],
    },
  },
  DATA_ENGINEERING: {
    label: "Data Engineering",
    technical: true,
    titleSignals: /\b(data engineer|etl developer|big data|data platform engineer|analytics engineer)\b/i,
    skillSignals: ["ETL", "Apache Spark", "Airflow", "dbt", "Data warehousing", "Hadoop", "Streaming", "SQL", "Python", "Message queues", "Data modeling"],
    keywordSignals: /\b(pipelines?|ingestion|warehouse|lakehouse|batch|streaming|data quality)\b/i,
    standard: [
      { name: "Data pipeline design", category: "TECHNICAL", importance: "HIGH", description: "Reliable batch/stream pipelines with idempotency and backfills.", resumeSignals: ["pipeline", "pipelines", "etl"] },
      { name: "Data modeling", category: "TECHNICAL", importance: "HIGH", description: "Warehouse and schema design for analytics." },
      { name: "Data quality", category: "PRACTICE", importance: "MEDIUM", description: "Validation, monitoring and lineage of data.", resumeSignals: ["data quality", "validation"] },
    ],
    practical: {
      type: "DATA_PIPELINE_DESIGN",
      title: "Pipeline design exercise",
      competency: "Data pipeline design",
      reason: "Data engineering is evidenced by designing a pipeline that handles late, duplicate and bad data.",
      expectedEvidence: ["Clear source-to-target flow", "Idempotency and backfill plan", "Data quality checks", "Cost/latency trade-offs"],
    },
  },
  DEVOPS: {
    label: "DevOps",
    technical: true,
    titleSignals: /\b(devops|dev ops|build engineer|release engineer|platform engineer|ci\/cd engineer)\b/i,
    skillSignals: ["Docker", "Kubernetes", "Terraform", "Ansible", "CI/CD", "Linux", "AWS", "Azure", "GCP", "Bash", "Observability", "Git"],
    keywordSignals: /\b(deployments?|pipelines?|infrastructure|automation|provisioning|containers?)\b/i,
    standard: [
      { name: "CI/CD", category: "TECHNICAL", importance: "HIGH", description: "Designing safe build, test and release pipelines." },
      { name: "Infrastructure as code", category: "TECHNICAL", importance: "HIGH", description: "Reproducible, reviewed infrastructure changes.", resumeSignals: ["terraform", "infrastructure as code"] },
      { name: "Observability", category: "TECHNICAL", importance: "MEDIUM", description: "Metrics, logs and alerts that surface real problems." },
    ],
    practical: {
      type: "INFRASTRUCTURE_SCENARIO",
      title: "Deployment pipeline scenario",
      competency: "CI/CD",
      reason: "DevOps work is evidenced by designing a safe path from commit to production, including rollback.",
      expectedEvidence: ["Pipeline stages with gates", "Rollback strategy", "Secrets handling", "Monitoring after deploy"],
    },
  },
  SRE: {
    label: "Site Reliability Engineering",
    technical: true,
    titleSignals: /\b(site reliability|sre|reliability engineer|production engineer)\b/i,
    skillSignals: ["SLOs", "Observability", "Incident management", "Kubernetes", "Linux", "Networking", "Go", "Python", "Terraform"],
    keywordSignals: /\b(reliability|uptime|availability|on[- ]call|incidents?|slos?|error budgets?)\b/i,
    standard: [
      { name: "Incident management", category: "PRACTICE", importance: "HIGH", description: "Leading detection, mitigation and blameless follow-up." },
      { name: "SLOs", category: "TECHNICAL", importance: "HIGH", description: "Defining and operating against service level objectives." },
      { name: "Capacity and performance", category: "TECHNICAL", importance: "MEDIUM", description: "Forecasting load and removing bottlenecks.", resumeSignals: ["capacity", "performance", "scaling"] },
    ],
    practical: {
      type: "INCIDENT_RESPONSE",
      title: "Incident response walkthrough",
      competency: "Incident management",
      reason: "SRE work is evidenced by how someone triages, mitigates and learns from a production incident.",
      expectedEvidence: ["Structured triage", "Mitigation before root cause", "Communication during incident", "Actionable follow-ups"],
    },
  },
  CLOUD_ENGINEERING: {
    label: "Cloud Engineering",
    technical: true,
    titleSignals: /\b(cloud (?:engineer|developer|administrator|specialist|consultant)|aws (?:engineer|developer)|azure (?:engineer|developer|administrator)|gcp engineer)\b/i,
    skillSignals: ["AWS", "Azure", "GCP", "Terraform", "Kubernetes", "Docker", "Networking", "Identity and access management", "Linux"],
    keywordSignals: /\b(cloud|vpc|iam|serverless|multi[- ]region|cost optimi[sz]ation)\b/i,
    standard: [
      { name: "Cloud architecture", category: "TECHNICAL", importance: "HIGH", description: "Choosing and composing managed services appropriately.", resumeSignals: ["cloud", "aws", "azure", "gcp"] },
      { name: "Cloud security and IAM", category: "TECHNICAL", importance: "HIGH", description: "Least privilege, network isolation and secrets." },
      { name: "Cost management", category: "PRACTICE", importance: "MEDIUM", description: "Understanding and controlling cloud spend.", resumeSignals: ["cost"] },
    ],
    practical: {
      type: "INFRASTRUCTURE_SCENARIO",
      title: "Cloud architecture scenario",
      competency: "Cloud architecture",
      reason: "Cloud engineering is evidenced by designing a secure, cost-aware deployment for a given workload.",
      expectedEvidence: ["Service choices with justification", "Network and IAM design", "Resilience plan", "Cost considerations"],
    },
  },
  QA_TESTING: {
    label: "QA / Testing",
    technical: true,
    titleSignals: /\b(qa|quality assurance|quality engineer|test engineer|tester|sdet|test automation|automation (?:tester|engineer))\b/i,
    skillSignals: ["Test automation", "Selenium", "Cypress", "Unit testing", "API testing", "Performance testing", "Manual testing"],
    keywordSignals: /\b(test cases?|test plans?|regression|defects?|bugs?|quality)\b/i,
    standard: [
      { name: "Test design", category: "PRACTICE", importance: "HIGH", description: "Deriving effective test cases from requirements and risk.", resumeSignals: ["test cases", "test plan"] },
      { name: "Test automation", category: "TECHNICAL", importance: "HIGH", description: "Maintainable automated tests at the right layer." },
      { name: "Defect reporting", category: "PRACTICE", importance: "MEDIUM", description: "Clear, reproducible bug reports and triage.", resumeSignals: ["defects", "bugs"] },
    ],
    practical: {
      type: "TEST_PLAN",
      title: "Test plan for a feature",
      competency: "Test design",
      reason: "QA work is evidenced by a risk-based test plan and choice of what to automate.",
      expectedEvidence: ["Risk-based coverage", "Positive/negative/edge cases", "Automation vs manual split", "Clear defect criteria"],
    },
  },
  CYBERSECURITY: {
    label: "Cybersecurity",
    technical: true,
    titleSignals: /\b(security (?:engineer|analyst|architect|specialist|consultant)|cyber ?security|soc analyst|penetration tester|pentester|infosec|appsec|application security)\b/i,
    skillSignals: ["Application security", "Network security", "Penetration testing", "SIEM", "Identity and access management", "Threat modeling", "Vulnerability management", "Security compliance"],
    keywordSignals: /\b(threats?|vulnerabilit(?:y|ies)|security|incidents?|compliance|risk assessments?)\b/i,
    standard: [
      { name: "Threat modeling", category: "TECHNICAL", importance: "HIGH", description: "Identifying assets, threats and mitigations." },
      { name: "Vulnerability management", category: "TECHNICAL", importance: "HIGH", description: "Finding, prioritising and verifying fixes." },
      { name: "Security incident response", category: "PRACTICE", importance: "MEDIUM", description: "Containment, investigation and reporting.", resumeSignals: ["incident"] },
    ],
    practical: {
      type: "SECURITY_SCENARIO",
      title: "Security scenario review",
      competency: "Threat modeling",
      reason: "Security work is evidenced by analysing a system or incident and prioritising mitigations.",
      expectedEvidence: ["Assets and threats identified", "Prioritised mitigations", "Detection approach", "Clear risk communication"],
    },
  },
  DATABASE_ENGINEERING: {
    label: "Database Engineering",
    technical: true,
    titleSignals: /\b(database (?:engineer|administrator|developer|architect)|dba|sql developer|data architect)\b/i,
    skillSignals: ["SQL", "PostgreSQL", "MySQL", "SQL Server", "Oracle Database", "MongoDB", "NoSQL", "Database performance tuning", "Data modeling"],
    keywordSignals: /\b(databases?|replication|backups?|indexes|query performance|schemas?)\b/i,
    standard: [
      { name: "Data modeling", category: "TECHNICAL", importance: "HIGH", description: "Schema design, normalisation and constraints." },
      { name: "Database performance tuning", category: "TECHNICAL", importance: "HIGH", description: "Indexes, query plans and contention." },
      { name: "Backup, recovery and replication", category: "TECHNICAL", importance: "MEDIUM", description: "Protecting data and meeting recovery objectives.", resumeSignals: ["backup", "replication", "recovery"] },
    ],
    practical: {
      type: "DATA_MODEL_DESIGN",
      title: "Schema and query tuning exercise",
      competency: "Database performance tuning",
      reason: "Database roles are evidenced by designing a schema and fixing a slow query with a clear rationale.",
      expectedEvidence: ["Sound schema with constraints", "Index choices justified", "Reading of a query plan", "Recovery considerations"],
    },
  },
  UI_UX_DESIGN: {
    label: "UI/UX Design",
    technical: false,
    titleSignals: /\b(ux|ui\/ux|ui designer|product designer|interaction designer|user researcher|visual designer|experience designer)\b/i,
    skillSignals: ["Figma", "User research", "Wireframing", "Interaction design", "Visual design", "Design systems", "Web accessibility"],
    keywordSignals: /\b(user experience|usability|personas?|journeys?|prototypes?|design thinking)\b/i,
    standard: [
      { name: "User research", category: "PRACTICE", importance: "HIGH", description: "Planning research and turning findings into decisions." },
      { name: "Interaction design", category: "PRACTICE", importance: "HIGH", description: "Flows, states and information architecture." },
      { name: "Visual design", category: "PRACTICE", importance: "MEDIUM", description: "Hierarchy, typography and consistency." },
    ],
    practical: {
      type: "DESIGN_CRITIQUE",
      title: "Design critique / portfolio walkthrough",
      competency: "Interaction design",
      reason: "Design work is evidenced by critiquing a flow and explaining decisions grounded in user needs.",
      expectedEvidence: ["Problems identified with rationale", "User-centred improvements", "Accessibility considered", "Clear communication of trade-offs"],
    },
  },
  PRODUCT_MANAGEMENT: {
    label: "Product Management",
    technical: false,
    titleSignals: /\b(product manager|product owner|product management|head of product|product lead|group product manager)\b/i,
    skillSignals: ["Product strategy", "Prioritization", "Product analytics", "Go-to-market", "Agile", "Stakeholder management", "Requirements gathering"],
    keywordSignals: /\b(roadmap|product vision|customers?|discovery|prioriti[sz]|market)\b/i,
    standard: [
      { name: "Product strategy", category: "PRACTICE", importance: "HIGH", description: "Setting direction from user, market and business evidence." },
      { name: "Prioritization", category: "PRACTICE", importance: "HIGH", description: "Making and defending trade-offs under constraints." },
      { name: "Product analytics", category: "PRACTICE", importance: "MEDIUM", description: "Defining success metrics and reading results." },
    ],
    practical: {
      type: "PRODUCT_CASE",
      title: "Product case",
      competency: "Prioritization",
      reason: "Product management is evidenced by framing a problem, prioritising options and defining success.",
      expectedEvidence: ["Clear problem and user", "Options with prioritisation rationale", "Success metrics", "Risks and assumptions"],
    },
  },
  BUSINESS_ANALYSIS: {
    label: "Business Analysis",
    technical: false,
    titleSignals: /\b(business analyst|business systems analyst|functional analyst|systems analyst|business process analyst)\b/i,
    skillSignals: ["Requirements gathering", "Process modeling", "Gap analysis", "SQL", "Excel", "Stakeholder management", "Agile", "Jira"],
    keywordSignals: /\b(requirements?|business processes?|user stories|acceptance criteria|as[- ]is|to[- ]be)\b/i,
    standard: [
      { name: "Requirements gathering", category: "PRACTICE", importance: "HIGH", description: "Eliciting, clarifying and documenting requirements." },
      { name: "Process modeling", category: "PRACTICE", importance: "MEDIUM", description: "Mapping current and future processes." },
      { name: "Stakeholder management", category: "PRACTICE", importance: "MEDIUM", description: "Aligning people with competing needs." },
    ],
    practical: {
      type: "REQUIREMENTS_ANALYSIS",
      title: "Requirements analysis case",
      competency: "Requirements gathering",
      reason: "BA work is evidenced by turning an ambiguous brief into clear, testable requirements.",
      expectedEvidence: ["Clarifying questions", "User stories with acceptance criteria", "Process view", "Identified gaps and risks"],
    },
  },
  PROJECT_PROGRAM_MANAGEMENT: {
    label: "Project / Program Management",
    technical: false,
    titleSignals: /\b(project manager|program manager|programme manager|delivery manager|scrum master|pmo|project coordinator)\b/i,
    skillSignals: ["Agile", "Jira", "Risk management", "Budgeting", "Stakeholder management", "Project planning"],
    keywordSignals: /\b(deliver(?:y|ables)|timelines?|milestones?|schedules?|risks?|dependencies)\b/i,
    standard: [
      { name: "Project planning", category: "PRACTICE", importance: "HIGH", description: "Scope, schedule, dependencies and resourcing." },
      { name: "Risk management", category: "PRACTICE", importance: "HIGH", description: "Identifying and mitigating delivery risk early." },
      { name: "Stakeholder management", category: "PRACTICE", importance: "MEDIUM", description: "Status, escalation and expectation management." },
    ],
    practical: {
      type: "PROJECT_PLAN_CASE",
      title: "Project recovery case",
      competency: "Risk management",
      reason: "Delivery roles are evidenced by planning or recovering a project with real constraints.",
      expectedEvidence: ["Structured plan or recovery steps", "Risks with owners", "Stakeholder communication", "Trade-off decisions"],
    },
  },
  ENGINEERING_MANAGEMENT: {
    label: "Engineering Management",
    technical: false,
    titleSignals: /\b(engineering manager|head of engineering|director of engineering|vp,? engineering|vp of engineering|development manager|software development manager|cto)\b/i,
    skillSignals: ["Agile", "Stakeholder management", "System design"],
    keywordSignals: /\b(direct reports|hiring|people management|performance reviews?|team health|career growth)\b/i,
    standard: [
      { name: "People leadership", category: "LEADERSHIP", importance: "HIGH", description: "Coaching, feedback, hiring and team health.", resumeSignals: ["managed", "mentored", "hired", "team of"] },
      { name: "Delivery management", category: "PRACTICE", importance: "HIGH", description: "Predictable delivery with sustainable pace." },
      { name: "Technical judgment", category: "TECHNICAL", importance: "MEDIUM", description: "Guiding architecture and quality decisions without owning every detail." },
    ],
    practical: {
      type: "LEADERSHIP_SCENARIO",
      title: "Leadership scenario",
      competency: "People leadership",
      reason: "Engineering management is evidenced by how someone handles people, delivery and technical trade-offs together.",
      expectedEvidence: ["Balanced people and delivery reasoning", "Clear communication plan", "Fair, evidence-based feedback", "Follow-up actions"],
    },
  },
  SOLUTIONS_ARCHITECTURE: {
    label: "Solutions Architecture",
    technical: true,
    titleSignals: /\b(solutions? architect|enterprise architect|technical architect|software architect|integration architect)\b/i,
    skillSignals: ["Solution architecture", "System design", "Integration patterns", "Microservices", "AWS", "Azure", "GCP", "Security compliance"],
    keywordSignals: /\b(architecture|integrations?|non[- ]functional|scalab|technical design|pre[- ]sales)\b/i,
    standard: [
      { name: "Solution architecture", category: "TECHNICAL", importance: "HIGH", description: "Designing systems that meet functional and non-functional needs." },
      { name: "Integration patterns", category: "TECHNICAL", importance: "HIGH", description: "Connecting systems reliably and securely." },
      { name: "Architecture communication", category: "COMMUNICATION", importance: "MEDIUM", description: "Explaining designs and trade-offs to technical and business audiences." },
    ],
    practical: {
      type: "ARCHITECTURE_REVIEW",
      title: "Architecture design review",
      competency: "Solution architecture",
      reason: "Architecture roles are evidenced by producing and defending a design against stated requirements.",
      expectedEvidence: ["Requirements and constraints captured", "Component and integration design", "Non-functional trade-offs", "Clear diagrams/explanation"],
    },
  },
  TECHNICAL_SUPPORT: {
    label: "Technical Support",
    technical: true,
    titleSignals: /\b(support engineer|technical support|help ?desk|it support|service desk|desktop support|application support|support specialist|support analyst)\b/i,
    skillSignals: ["Troubleshooting", "Ticketing systems", "ITIL", "Active Directory", "Linux", "Networking", "SQL"],
    keywordSignals: /\b(tickets?|customers?|troubleshoot|escalat|sla|end users?)\b/i,
    standard: [
      { name: "Troubleshooting", category: "TECHNICAL", importance: "HIGH", description: "Systematic diagnosis of user-reported problems." },
      { name: "Customer communication", category: "COMMUNICATION", importance: "HIGH", description: "Clear, empathetic updates to non-technical users.", resumeSignals: ["customers", "users"] },
      { name: "Escalation and documentation", category: "PRACTICE", importance: "MEDIUM", description: "Knowing when to escalate and leaving a useful record.", resumeSignals: ["escalation", "knowledge base"] },
    ],
    practical: {
      type: "TROUBLESHOOTING_SCENARIO",
      title: "Troubleshooting scenario",
      competency: "Troubleshooting",
      reason: "Support roles are evidenced by a structured diagnosis of a realistic ticket.",
      expectedEvidence: ["Clarifying questions", "Systematic isolation steps", "Clear customer update", "Escalation criteria"],
    },
  },
  TECHNICAL_WRITING: {
    label: "Technical Writing",
    technical: false,
    titleSignals: /\b(technical writer|technical author|documentation (?:engineer|specialist)|documentation writer|api writer)\b/i,
    skillSignals: ["Technical writing", "API documentation", "Docs-as-code", "Git"],
    keywordSignals: /\b(documentation|user guides?|release notes|style guides?|knowledge base)\b/i,
    standard: [
      { name: "Technical writing", category: "COMMUNICATION", importance: "HIGH", description: "Accurate, task-oriented documentation." },
      { name: "Information architecture", category: "PRACTICE", importance: "MEDIUM", description: "Organising docs so users find answers." },
      { name: "Working with subject-matter experts", category: "PRACTICE", importance: "MEDIUM", description: "Extracting accurate information from engineers." },
    ],
    practical: {
      type: "WRITING_SAMPLE",
      title: "Documentation writing sample",
      competency: "Technical writing",
      reason: "Technical writing is evidenced by rewriting or producing a short, accurate doc for a stated audience.",
      expectedEvidence: ["Accurate content", "Audience-appropriate structure", "Clear task steps", "Consistent style"],
    },
  },
};

/** Behavioural competencies every plan includes as ROLE_STANDARD unless the JD states them. */
export const COMMON_COMPETENCIES: StandardCompetency[] = [
  {
    name: "Collaboration",
    category: "BEHAVIORAL",
    importance: "MEDIUM",
    description: "Working effectively with teammates and other functions.",
  },
  {
    name: "Communication",
    category: "COMMUNICATION",
    importance: "MEDIUM",
    description: "Explaining ideas clearly to the relevant audience.",
  },
];

export const LEADERSHIP_COMPETENCY: StandardCompetency = {
  name: "Technical leadership",
  category: "LEADERSHIP",
  importance: "HIGH",
  description: "Guiding others, mentoring and owning outcomes beyond individual tasks.",
  resumeSignals: ["led", "mentored", "lead"],
};

/** Fallback when no family can be identified with enough evidence. */
export const UNKNOWN_FAMILY_STANDARD: StandardCompetency[] = [
  {
    name: "Problem solving",
    category: "PRACTICE",
    importance: "MEDIUM",
    description: "Breaking down unfamiliar problems and reasoning to a solution.",
  },
  {
    name: "Ownership and delivery",
    category: "BEHAVIORAL",
    importance: "MEDIUM",
    description: "Taking responsibility for outcomes and following through.",
  },
];

export const UNKNOWN_PRACTICAL: PracticalTemplate = {
  type: "RECRUITER_DEFINED",
  title: "Recruiter-defined work sample",
  competency: "Problem solving",
  reason:
    "The role family could not be determined with enough evidence, so no practical format is recommended automatically. The recruiter should define a work sample that matches the real job.",
  expectedEvidence: ["Defined by the recruiter for this role"],
};

export function familyLabel(family: string): string {
  if (family === "HYBRID") return "Hybrid role";
  if (family === "UNKNOWN") return "Unknown / unclassified";
  return ROLE_TAXONOMY[family as ConcreteRoleFamily]?.label ?? family;
}
