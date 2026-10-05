import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, requireOrganizationId, requireRoles } from "@/lib/auth/rbac";
import { isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { addToHiring } from "@/lib/hiring/add-to-hiring";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const ADD_TO_HIRING_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "RECRUITER", "HIRING_MANAGER"];

const idSchema = z.string().min(1).max(64);
const bodySchema = z.object({ jobId: idSchema }).strict();

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** Add to Hiring: puts a candidate into one open job opening (Applied). No AI runs; no interview is created. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const user = requireRoles(await getSession(), ADD_TO_HIRING_ROLES);
    const organizationId = requireOrganizationId(user);

    const rl = rateLimit({ key: `add-to-job:${user.id}`, limit: 60, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return noStore(jsonError("Too many requests. Wait a few minutes and try again.", 429));

    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return noStore(jsonError("Send the request as JSON.", 415));
    }
    const candidateId = idSchema.safeParse(params.id);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!candidateId.success) return noStore(jsonError("Candidate not found", 404));
    if (!body.success) return noStore(jsonError("Choose a job opening from the list.", 400));

    const result = await addToHiring(prisma, { organizationId, candidateId: candidateId.data, jobId: body.data.jobId });
    switch (result.kind) {
      case "added":
        return noStore(jsonOk({ applicationId: result.applicationId }, { status: 201 }));
      case "candidate_not_found":
        return noStore(jsonError("Candidate not found", 404));
      case "job_not_open":
        return noStore(jsonError("Choose an open job opening from the list.", 400));
      case "already_in_job":
        return noStore(jsonError("This candidate is already in that job opening.", 409));
    }
  } catch (err) {
    if (err instanceof AuthError) return noStore(jsonError(err.message, err.status));
    if (isDatabaseUnavailable(err)) return noStore(jsonError("HireOS is temporarily unavailable. Try again.", 503));
    console.error("[add-to-hiring] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return noStore(jsonError("Could not add to hiring. Try again.", 500));
  }
}
