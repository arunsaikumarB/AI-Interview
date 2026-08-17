/** Django Job list/detail item → Next GET /api/jobs shape. */
export type DjangoJob = {
  id: string;
  organizationId: string;
  departmentId: string | null;
  title: string;
  description: string;
  location: string | null;
  experienceMin: number;
  experienceMax: number | null;
  skills: string[] | null;
  salaryMin: number | null;
  salaryMax: number | null;
  employmentType: string;
  openings: number;
  status: string;
  interviewStages: unknown;
  screeningCriteria: unknown;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  applicationCount?: number;
  organization?: { id: string; name: string; slug: string } | null;
  department?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string; email: string } | null;
};

export type DjangoCandidate = {
  id: string;
  organizationId: string;
  userId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  linkedIn: string | null;
  location: string | null;
  summary: string | null;
  skills: string[] | null;
  experience: number;
  education: unknown;
  certifications: unknown;
  resumeUrl: string | null;
  resumeText: string | null;
  createdAt: string;
  updatedAt: string;
  applicationCount?: number;
  organization?: { id: string; name: string; slug: string } | null;
};

export type DjangoApplication = {
  id: string;
  candidateId: string;
  jobId: string;
  stage: string;
  status: string;
  source: string | null;
  coverNote: string | null;
  createdAt: string;
  updatedAt: string;
  candidate: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    experience?: number;
    skills?: string[];
  };
  job: {
    id: string;
    title: string;
    status: string;
    department: { name: string } | null;
  };
};

export function normalizeJob(job: DjangoJob) {
  return {
    id: job.id,
    organizationId: job.organizationId,
    departmentId: job.departmentId,
    title: job.title,
    description: job.description,
    location: job.location,
    experienceMin: job.experienceMin,
    experienceMax: job.experienceMax,
    skills: job.skills ?? [],
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    employmentType: job.employmentType,
    openings: job.openings,
    status: job.status,
    interviewStages: job.interviewStages,
    screeningCriteria: job.screeningCriteria,
    createdById: job.createdById,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    organization: job.organization ?? null,
    department: job.department ?? null,
    createdBy: job.createdBy ?? null,
    _count: { applications: job.applicationCount ?? 0 },
  };
}

export function normalizeCandidateListItem(c: DjangoCandidate) {
  return {
    id: c.id,
    organizationId: c.organizationId,
    userId: c.userId,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    linkedIn: c.linkedIn,
    location: c.location,
    summary: c.summary,
    skills: c.skills ?? [],
    experience: c.experience,
    education: c.education,
    certifications: c.certifications,
    resumeUrl: c.resumeUrl,
    resumeText: c.resumeText,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    _count: { applications: c.applicationCount ?? 0 },
  };
}

/** Next GET /api/applications list shape (no invented AI evaluations). */
export function normalizeApplicationListItem(app: DjangoApplication) {
  return {
    id: app.id,
    candidateId: app.candidateId,
    jobId: app.jobId,
    stage: app.stage,
    status: app.status,
    source: app.source,
    coverNote: app.coverNote,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    job: {
      id: app.job.id,
      title: app.job.title,
      status: app.job.status,
      department: app.job.department,
    },
    candidate: {
      id: app.candidate.id,
      firstName: app.candidate.firstName,
      lastName: app.candidate.lastName,
      email: app.candidate.email,
    },
  };
}
