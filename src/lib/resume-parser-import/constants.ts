import type { Role } from "@prisma/client";

/** Application.source for rows imported from a Resume Parser export. */
export const RESUME_PARSER_SOURCE = "resume_parser";
export const RESUME_PARSER_LABEL = "Resume Parser";

export const IMPORT_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITER"];

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 25_000;
export const IMPORT_ERROR_LIST_LIMIT = 200;

export const HISTORICAL_JOB_DESCRIPTION =
  "Historical role imported from Resume Parser. Created automatically so past applications keep their role. Not open for applications.";
