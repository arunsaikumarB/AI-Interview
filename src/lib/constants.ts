import type { PipelineStage, Role } from "@prisma/client";

export const ROLES = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "RECRUITER",
  "HIRING_MANAGER",
  "INTERVIEWER",
  "CANDIDATE",
] as const satisfies readonly Role[];

export const PIPELINE_STAGES = [
  "APPLIED",
  "SCREENING",
  "SHORTLISTED",
  "ASSESSMENT",
  "AI_INTERVIEW",
  "TECH_INTERVIEW",
  "HR_INTERVIEW",
  "SELECTED",
  "REJECTED",
] as const satisfies readonly PipelineStage[];

/** Ordered hiring flow (terminal stages excluded from linear advance). */
export const PIPELINE_FLOW: PipelineStage[] = [
  "APPLIED",
  "SCREENING",
  "SHORTLISTED",
  "ASSESSMENT",
  "AI_INTERVIEW",
  "TECH_INTERVIEW",
  "HR_INTERVIEW",
];

export const TERMINAL_STAGES: PipelineStage[] = ["SELECTED", "REJECTED"];

export const STAFF_ROLES: Role[] = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "RECRUITER",
  "HIRING_MANAGER",
  "INTERVIEWER",
];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring Manager",
  INTERVIEWER: "Interviewer",
  CANDIDATE: "Candidate",
};

export const STAGE_LABELS: Record<PipelineStage, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  SHORTLISTED: "Shortlisted",
  ASSESSMENT: "Assessment",
  AI_INTERVIEW: "AI Interview",
  TECH_INTERVIEW: "Tech Interview",
  HR_INTERVIEW: "HR Interview",
  SELECTED: "Selected",
  REJECTED: "Rejected",
};

/** Candidate-facing stage labels — never expose internal pipeline names. */
export const CANDIDATE_STAGE_LABELS: Record<PipelineStage, string> = {
  APPLIED: "Received",
  SCREENING: "Under review",
  SHORTLISTED: "Under review",
  ASSESSMENT: "Interview stage",
  AI_INTERVIEW: "Interview stage",
  TECH_INTERVIEW: "Interview stage",
  HR_INTERVIEW: "Interview stage",
  SELECTED: "Offer",
  REJECTED: "Not selected",
};

export function candidateStageLabel(stage: PipelineStage): string {
  return CANDIDATE_STAGE_LABELS[stage] ?? "Under review";
}

export const INTERVIEW_TYPES = [
  "TECHNICAL",
  "HR",
  "BEHAVIORAL",
  "MANAGERIAL",
  "FULLSTACK",
  "DATA_AI",
  "CUSTOM",
] as const;

export type InterviewTypeOption = (typeof INTERVIEW_TYPES)[number];
