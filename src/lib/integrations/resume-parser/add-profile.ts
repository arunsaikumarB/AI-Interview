import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { uploadRowSchema } from "@/lib/resume-upload/constants";
import { extractResumeFields } from "@/lib/resume-upload/extract";
import { normalizeSkillList } from "@/lib/resume-upload/profile";
import { saveUploadedResume, type UploadDeps } from "@/lib/resume-upload/upload";
import type { ResumeParserClient } from "./client";
import type { ResumeParserProfile } from "./types";

export type AddProfileResult =
  | { status: "created"; candidateId: string; parsed: boolean }
  | { status: "exists"; candidateId: string }
  | { status: "no_email" }
  | { status: "no_file" }
  | { status: "invalid_file"; reason: string };

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "text/plain": ".txt",
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

const emailSchema = z.string().trim().toLowerCase().max(254).email();
const MAX_SKILLS = 40;

/** First valid address in a field that may hold several. */
function firstEmail(raw: string): string {
  for (const part of raw.split(/[\s,;]+/)) {
    const parsed = emailSchema.safeParse(part);
    if (parsed.success) return parsed.data;
  }
  return "";
}

/** First phone number in a field that may hold several, in the characters HireOS accepts. */
export function firstPhone(raw: string): string {
  const match = /\+?\d[\d\s().-]{6,24}\d/.exec(raw);
  return match ? match[0].replace(/\s+/g, " ").slice(0, 30) : "";
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
}

/** A plain, safe file name whose extension matches the file type. */
export function resumeFileName(profileId: number, preferred: string | null, mimeType: string): string {
  const base = (preferred ?? "").replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[.\s]+/, "").trim().slice(0, 200);
  const known = MIME_BY_EXT[extOf(base)] ? extOf(base) : "";
  const ext = known || EXT_BY_MIME[mimeType] || "";
  const stem = (known ? base.slice(0, -known.length) : base).trim() || `resume-${profileId}`;
  return `${stem}${ext}`;
}

export function linkedInUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString().slice(0, 300) : "";
  } catch {
    return "";
  }
}

function experienceOf(years: number | null): number | null {
  if (years === null || years > 50) return null;
  return Math.round(years * 10) / 10;
}

/**
 * Brings one Resume Parser profile into the Talent Pool as a candidate with no job. The profile
 * must come from this server's own search results; the resume is downloaded from Resume Parser,
 * checked like any upload and read locally. An existing candidate with the same email is never
 * changed. Nothing enters hiring and no AI scoring runs.
 */
export async function addResumeParserProfile(
  db: PrismaClient,
  args: {
    organizationId: string;
    userId: string;
    profile: ResumeParserProfile;
    client: ResumeParserClient;
    deps: UploadDeps;
  },
): Promise<AddProfileResult> {
  const { organizationId, profile, deps } = args;

  const findExisting = async (email: string) =>
    db.candidate.findFirst({
      where: { organizationId, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

  let email = firstEmail(profile.email);
  if (email) {
    const existing = await findExisting(email);
    if (existing) return { status: "exists", candidateId: existing.id };
  }

  const file = await args.client.getResumeFile(profile.id);
  if (!file) return { status: "no_file" };

  const fileName = resumeFileName(profile.id, profile.file_name || file.fileName, file.mimeType);
  const mimeType = MIME_BY_EXT[extOf(fileName)] ?? file.mimeType;

  let fromFile = { firstName: "", lastName: "", email: "", phone: "", experience: null as number | null };
  if (!email || !profile.name) {
    const text = await deps
      .extractText({ buffer: file.data, mimeType, fileName })
      .catch(() => "");
    fromFile = extractResumeFields(text, fileName);
  }
  if (!email) {
    email = firstEmail(fromFile.email);
    if (!email) return { status: "no_email" };
    const existing = await findExisting(email);
    if (existing) return { status: "exists", candidateId: existing.id };
  }

  const names = profile.name.split(/\s+/).filter(Boolean);
  const firstName = (names[0] ?? fromFile.firstName ?? "").slice(0, 100) || email.split("@")[0].slice(0, 100);
  const lastName = (names.length > 0 ? names.slice(1).join(" ") : fromFile.lastName).slice(0, 100);
  const row = uploadRowSchema.parse({
    fileName,
    firstName,
    lastName,
    email,
    phone: firstPhone(profile.phone_numbers),
    experience: experienceOf(profile.total_experience),
  });

  const result = await saveUploadedResume(db, {
    organizationId,
    jobId: null,
    row,
    type: mimeType,
    buffer: file.data,
    deps,
    overrides: {
      location: [profile.location, profile.region].filter(Boolean).join(", ").slice(0, 200),
      linkedIn: linkedInUrl(profile.linkedin),
      skills: normalizeSkillList(profile.skills).slice(0, MAX_SKILLS),
    },
    note: { authorId: args.userId, text: `Added to the Talent Pool from Resume Parser (profile ${profile.id}).` },
  });

  if (result.status === "created" || result.status === "exists") {
    const candidate = await findExisting(email);
    if (candidate) {
      return result.status === "created"
        ? { status: "created", candidateId: candidate.id, parsed: Boolean(result.parsed) }
        : { status: "exists", candidateId: candidate.id };
    }
  }
  if (result.status === "invalid") return { status: "invalid_file", reason: result.reason ?? "file is not allowed" };
  throw new Error(`resume_parser_add_unexpected_${result.status}`);
}
