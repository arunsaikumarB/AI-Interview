/**
 * Recruiter-facing Interview Links helpers — status labels + link URLs.
 * Does not change engine behavior.
 */

export type InterviewLinkDisplayStatus =
  | "Active"
  | "Scheduled"
  | "In Progress"
  | "Completed"
  | "Expired"
  | "Cancelled";

export function interviewLinkDisplayStatus(params: {
  status: string;
  tokenExpiresAt: string | Date | null | undefined;
  now?: Date;
}): InterviewLinkDisplayStatus {
  const now = params.now ?? new Date();
  const expired =
    params.tokenExpiresAt != null &&
    new Date(params.tokenExpiresAt).getTime() < now.getTime();

  if (params.status === "COMPLETED") return "Completed";
  if (params.status === "CANCELLED" || params.status === "NO_SHOW") {
    return "Cancelled";
  }
  if (expired) return "Expired";
  if (params.status === "IN_PROGRESS") return "In Progress";
  if (params.status === "SCHEDULED") return "Active";
  return "Active";
}

export function candidateInterviewUrl(accessToken: string, origin?: string): string {
  const base =
    origin ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/interview/${accessToken}`;
}

export const LINK_EXPIRE_OPTIONS = [
  { value: 1, label: "24 hours" },
  { value: 3, label: "3 days" },
  { value: 7, label: "7 days" },
] as const;

export const DURATION_OPTIONS = [
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "60 minutes" },
] as const;

export const DEFAULT_LINK_EXPIRE_DAYS = 3;
export const DEFAULT_DURATION_MINUTES = 30;
