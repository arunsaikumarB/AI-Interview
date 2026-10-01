import { NextResponse } from "next/server";
import { loadBuildCommit, publicVersionPayload } from "@/lib/build-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public build identity for DevOps. `commit` is a git SHA baked at build time
 * (or "unknown"). No environment variables, URLs, paths, or dependency detail.
 */
export async function GET() {
  return NextResponse.json(publicVersionPayload(loadBuildCommit()));
}
