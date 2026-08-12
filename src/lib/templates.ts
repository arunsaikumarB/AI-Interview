/**
 * Email template interpolation — never invent values for missing keys.
 */

export const TEMPLATE_VARIABLES = [
  "candidateFirstName",
  "candidateLastName",
  "jobTitle",
  "companyName",
  "interviewLink",
  "recruiterName",
  "stage",
] as const;

export type TemplateVar = (typeof TEMPLATE_VARIABLES)[number];

export type TemplateContext = Partial<Record<TemplateVar, string | null | undefined>>;

export const TEMPLATE_CATEGORIES = [
  "application_received",
  "shortlisted",
  "interview_invite",
  "interview_reminder",
  "next_round",
  "rejection",
  "offer",
  "custom",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  application_received: "Application received",
  shortlisted: "Shortlisted",
  interview_invite: "Interview invite",
  interview_reminder: "Interview reminder",
  next_round: "Next round",
  rejection: "Rejection",
  offer: "Offer",
  custom: "Custom",
};

/** Stage → suggested template category (UI draft chips only). */
export const STAGE_TO_CATEGORY: Partial<Record<string, TemplateCategory>> = {
  SHORTLISTED: "shortlisted",
  AI_INTERVIEW: "interview_invite",
  REJECTED: "rejection",
  SELECTED: "offer",
};

export function listTemplateVariables(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

export function renderTemplate(
  body: string,
  context: TemplateContext,
): { rendered: string; missing: string[] } {
  const missing = new Set<string>();
  const rendered = body.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    (_full, name: string) => {
      const raw = context[name as TemplateVar];
      if (raw == null || String(raw).trim() === "") {
        missing.add(name);
        return `⚠️MISSING:${name}⚠️`;
      }
      return String(raw);
    },
  );
  return { rendered, missing: Array.from(missing) };
}

export function hasMissingMarkers(text: string): boolean {
  return /⚠️MISSING:[a-zA-Z0-9_]+⚠️/.test(text);
}
