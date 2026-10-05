import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, requireOrganizationId, requireRoles } from "@/lib/auth/rbac";
import { isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { browseTalent, talentFiltersSchema } from "@/lib/talent/browse";

export const dynamic = "force-dynamic";

const TALENT_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITER", "HIRING_MANAGER"];

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Talent Pool filter search: one page (25) for the caller's organization. No AI. */
export async function GET(request: Request) {
  try {
    const user = requireRoles(await getSession(), TALENT_ROLES);
    const organizationId = requireOrganizationId(user);

    const rl = rateLimit({ key: `talent-browse:${user.id}`, limit: 300, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return noStore(jsonError("Too many requests. Wait a few minutes and try again.", 429));

    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const filters = talentFiltersSchema.safeParse(params);
    if (!filters.success) {
      return noStore(jsonError(filters.error.issues[0]?.message ?? "Check the search filters.", 400));
    }
    return noStore(jsonOk(await browseTalent(prisma, organizationId, filters.data)));
  } catch (err) {
    if (err instanceof AuthError) return noStore(jsonError(err.message, err.status));
    if (isDatabaseUnavailable(err)) return noStore(jsonError("HireOS is temporarily unavailable. Try again.", 503));
    console.error("[talent-browse] failed", { name: err instanceof Error ? err.name : typeof err });
    return noStore(jsonError("Could not search the talent pool. Try again.", 500));
  }
}
