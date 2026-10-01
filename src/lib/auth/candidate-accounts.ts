/**
 * Candidate self-service accounts: /register, the careers "create an account"
 * password, candidate sign-in and the /portal area.
 *
 * Off unless CANDIDATE_ACCOUNTS_ENABLED=true (server-side, read at runtime).
 * Candidates never need an account for interviews or assessments: those use
 * the tokenized links staff send them.
 */
export function parseCandidateAccountsEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

export function candidateAccountsEnabled(): boolean {
  return parseCandidateAccountsEnabled(process.env.CANDIDATE_ACCOUNTS_ENABLED);
}

export const CANDIDATE_ACCOUNTS_DISABLED_MESSAGE =
  "Candidate accounts are not available. Use the interview or assessment link your recruiter sent you.";
