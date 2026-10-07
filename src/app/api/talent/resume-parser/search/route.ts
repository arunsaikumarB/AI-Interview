import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, requireOrganizationId, requireRoles } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { UPLOAD_ROLES } from "@/lib/resume-upload/constants";
import {
  getResumeParserClient,
  rememberProfiles,
  ResumeParserNotConfiguredError,
  ResumeParserUnavailableError,
} from "@/lib/integrations/resume-parser";
import { resumeParserErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const skillList = z
  .string()
  .max(600)
  .optional()
  .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().max(60).regex(/^[^\x00-\x1f]+$/)).max(25));

const optionalInt = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.coerce.number().int().min(0).max(60).optional(),
);

const optionalText = z
  .string()
  .max(80)
  .optional()
  .transform((v) => v?.trim() || undefined);

const querySchema = z
  .object({
    skills: skillList,
    anySkills: skillList,
    excludeSkills: skillList,
    minExperience: optionalInt,
    maxExperience: optionalInt,
    city: optionalText,
    state: optionalText,
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .refine((q) => q.minExperience === undefined || q.maxExperience === undefined || q.minExperience <= q.maxExperience);

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Skill search in Resume Parser for HR. Only the fields the Talent Pool shows are returned
 * (no phone or LinkedIn), plus whether the person is already a HireOS candidate.
 */
export async function GET(request: Request) {
  try {
    const user = requireRoles(await getSession(), UPLOAD_ROLES);
    const organizationId = requireOrganizationId(user);

    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      skills: params.get("skills") ?? undefined,
      anySkills: params.get("anySkills") ?? undefined,
      excludeSkills: params.get("excludeSkills") ?? undefined,
      minExperience: params.get("minExperience") ?? undefined,
      maxExperience: params.get("maxExperience") ?? undefined,
      city: params.get("city") ?? undefined,
      state: params.get("state") ?? undefined,
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
    });
    if (!parsed.success) return noStore(jsonError("Some search filters are not valid.", 400));
    const q = parsed.data;
    if (q.skills.length === 0 && q.anySkills.length === 0) {
      return noStore(jsonError("Enter at least one skill.", 400));
    }

    const client = getResumeParserClient();
    if (!client.configured) throw new ResumeParserNotConfiguredError();

    const rl = rateLimit({ key: `resume-parser-search:${user.id}`, limit: 120, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return noStore(jsonError("Too many searches. Wait a few minutes and try again.", 429));

    const page = await client.search(q, q.page, q.pageSize);
    rememberProfiles(organizationId, page.profiles);

    const emails = Array.from(new Set(page.profiles.map((p) => p.email.toLowerCase()).filter(Boolean)));
    const existing = emails.length
      ? await prisma.$queryRaw<{ id: string; email: string }[]>(Prisma.sql`
          SELECT DISTINCT ON (lower(email)) id, lower(email) AS email FROM "Candidate"
          WHERE "organizationId" = ${organizationId} AND lower(email) = ANY(${emails}::text[])
          ORDER BY lower(email), "createdAt" ASC`)
      : [];
    const candidateByEmail = new Map(existing.map((c) => [c.email, c.id]));

    return noStore(
      jsonOk({
        items: page.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          location: [p.location, p.region].filter(Boolean).join(", "),
          experience: p.total_experience,
          skills: p.skills,
          matchedSkills: p.matched_skills,
          addedAt: p.created_at,
          fileName: p.file_name || null,
          candidateId: (p.email && candidateByEmail.get(p.email.toLowerCase())) || null,
        })),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      }),
    );
  } catch (err) {
    if (err instanceof ResumeParserNotConfiguredError || err instanceof ResumeParserUnavailableError) {
      return noStore(resumeParserErrorResponse(err));
    }
    if (err instanceof AuthError || err instanceof ZodError || isDatabaseUnavailable(err)) {
      return noStore(handleApiError(err));
    }
    console.error("[resume-parser/search] failed", { name: err instanceof Error ? err.name : typeof err });
    return noStore(jsonError("The search failed. Try again.", 500));
  }
}
