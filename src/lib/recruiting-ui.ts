import type { EmploymentType, JobStatus, PipelineStage } from "@prisma/client";

/** Stages counted as “in interview” — same set as analytics. */
export const IN_INTERVIEW_STAGES: PipelineStage[] = [
  "ASSESSMENT",
  "AI_INTERVIEW",
  "TECH_INTERVIEW",
  "HR_INTERVIEW",
];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  PAUSED: "Paused",
  CLOSED: "Closed",
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Intern",
  TEMPORARY: "Temporary",
};

export function isInInterviewStage(stage: PipelineStage): boolean {
  return IN_INTERVIEW_STAGES.includes(stage);
}
