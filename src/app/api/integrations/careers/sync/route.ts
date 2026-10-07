import type { Role } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { AuthError, requireOrganizationId, requireRoles } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { getCareersRunner, logResult } from "@/lib/integrations/careers/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYNC_ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN"];

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** The runner, only for admins of the organization careers applications are imported into. */
async function authorizedRunner() {
  const user = requireRoles(await getSession(), SYNC_ROLES);
  const organizationId = requireOrganizationId(user);
  const runner = await getCareersRunner();
  if (!runner) return { user, runner: null };
  if ((await runner.organizationId()) !== organizationId) throw new AuthError("Forbidden", 403);
  return { user, runner };
}

function failure(err: unknown, action: string): Response {
  if (err instanceof AuthError || isDatabaseUnavailable(err)) return noStore(handleApiError(err));
  console.error(`[careers-sync] ${action} failed`, { name: err instanceof Error ? err.name : typeof err });
  return noStore(jsonError("Something went wrong. Try again.", 500));
}

/** Sync status: counts and times only. */
export async function GET() {
  try {
    const { runner } = await authorizedRunner();
    if (!runner) return noStore(jsonOk({ configured: false }));
    return noStore(jsonOk(await runner.status()));
  } catch (err) {
    return failure(err, "status");
  }
}

/** "Sync now": starts a full read in the background and returns at once. */
export async function POST() {
  try {
    const { user, runner } = await authorizedRunner();
    if (!runner) return noStore(jsonError("The careers site is not connected yet.", 503));
    if (runner.isRunning()) return noStore(jsonError("A sync is already running.", 409));
    const rl = rateLimit({ key: `careers-sync:${user.id}`, limit: 6, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return noStore(jsonError("Too many syncs. Wait a few minutes and try again.", 429));
    void runner
      .run("manual", user.id)
      .then(logResult)
      .catch((err: unknown) => console.error("[careers-sync] failed", { name: err instanceof Error ? err.name : typeof err }));
    return noStore(jsonOk({ started: true }, { status: 202 }));
  } catch (err) {
    return failure(err, "start");
  }
}
