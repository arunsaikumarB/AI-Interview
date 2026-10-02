/**
 * Interviewer orb switch.
 *
 * NEXT_PUBLIC_INTERVIEW_ORB=speaking (default) | classic
 *
 * `speaking` renders the vendored Speaking Orb. `classic` restores the
 * previous thinking-orbs interviewer with the same props and behaviour.
 *
 * Read on the server (dynamic key so Next does not inline the value at
 * build time) and passed into client components. Restart Next after changing
 * it. In production, a restart is enough when this module runs on the server;
 * a rebuild is still required if a client bundle captured an older value.
 *
 * Rollback without this branch: `git checkout main`.
 */

export type InterviewOrbVariant = "speaking" | "classic";

const FLAG_KEY = ["NEXT", "PUBLIC", "INTERVIEW", "ORB"].join("_");

export function parseInterviewOrbVariant(
  value: string | undefined | null,
): InterviewOrbVariant {
  if (!value) return "speaking";
  return value.trim().toLowerCase() === "classic" ? "classic" : "speaking";
}

/** Server/runtime read. Client bundles should use the prop from the page. */
export function readInterviewOrbFlag(): string | undefined {
  const raw = process.env[FLAG_KEY];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export function interviewOrbVariant(
  explicit?: string | null,
): InterviewOrbVariant {
  if (explicit != null) return parseInterviewOrbVariant(explicit);
  return parseInterviewOrbVariant(readInterviewOrbFlag());
}
