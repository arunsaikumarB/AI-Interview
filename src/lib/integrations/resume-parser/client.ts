import type { ResumeParserPage, ResumeParserRecord, ResumeParserResumeFile, ResumeParserSearch } from "./types";

/**
 * Server-side boundary to the Resume Parser application. Server code only: credentials for a
 * real client must come from server env (never NEXT_PUBLIC_*) and never reach the browser.
 * Resume Parser stays the source of truth for its history; HireOS never writes back.
 */
export interface ResumeParserClient {
  readonly configured: boolean;
  /** Server-side filtered, paginated search. */
  search(filters: ResumeParserSearch, page: number, pageSize: number): Promise<ResumeParserPage>;
  getRecord(externalId: string): Promise<ResumeParserRecord | null>;
  getResumeFile(externalId: string): Promise<ResumeParserResumeFile | null>;
}

export class ResumeParserNotConfiguredError extends Error {
  constructor() {
    super("The Resume Parser API is not connected yet.");
    this.name = "ResumeParserNotConfiguredError";
  }
}

const notConfigured = async (): Promise<never> => {
  throw new ResumeParserNotConfiguredError();
};

/** Used until the Resume Parser API (endpoints, auth, field names) is provided. */
export const notConfiguredResumeParserClient: ResumeParserClient = {
  configured: false,
  search: notConfigured,
  getRecord: notConfigured,
  getResumeFile: notConfigured,
};

export function getResumeParserClient(): ResumeParserClient {
  return notConfiguredResumeParserClient;
}
