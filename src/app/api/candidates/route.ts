import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { djangoListCandidatesPage } from "@/lib/staff-reads/django-reads";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";
import { useDjangoReads } from "@/lib/staff-reads/flag";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
});

/** List fields only: no phone, resume text, profile JSON, or account/org internals. */
const LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  location: true,
  skills: true,
  experience: true,
  resumeUrl: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { applications: true } },
} as const;

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Staff candidate list, one page at a time — CANDIDATE → 403. Portal uses /api/portal/profile. */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);

    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
      q: params.get("q") ?? undefined,
    });
    if (!parsed.success) {
      return noStore(jsonError("Invalid page, pageSize, or search.", 400));
    }
    const { page, pageSize } = parsed.data;
    const q = parsed.data.q || undefined;

    if (useDjangoReads()) {
      const result = await djangoListCandidatesPage(request, { page, pageSize, q });
      return noStore(jsonOk({ ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize) }));
    }

    const where = {
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
              { skills: { hasSome: [q] } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.candidate.count({ where }),
      prisma.candidate.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: LIST_SELECT,
      }),
    ]);

    const items = rows.map(({ _count, resumeUrl, ...c }) => ({
      ...c,
      applicationCount: _count.applications,
      hasResume: Boolean(resumeUrl),
    }));

    return noStore(jsonOk({ items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) }));
  } catch (err) {
    return noStore(djangoReadToResponse(err) ?? handleApiError(err));
  }
}
