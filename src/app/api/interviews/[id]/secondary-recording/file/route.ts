import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api";
import { readStoredFile, verifyStoredFile } from "@/lib/storage";
import { finalizeSecondaryRecording } from "@/lib/secondary-recording-server";

type Ctx = { params: { id: string } };

/**
 * Authenticated recruiter playback — never public /storage URL.
 * CANDIDATE → 403.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    const interview = await prisma.interviewSession.findUnique({
      where: { id: params.id },
      include: {
        application: {
          include: { job: { select: { organizationId: true } } },
        },
      },
    });
    if (!interview) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (
      user.role !== "SUPER_ADMIN" &&
      user.organizationId &&
      interview.application.job.organizationId !== user.organizationId
    ) {
      throw new AuthError("Insufficient permissions", 403);
    }
    let relativePath = interview.secondaryRecordingPath;
    if (relativePath) {
      const present = await verifyStoredFile(relativePath);
      if (!present.ok) {
        relativePath = null;
      }
    }
    if (!relativePath && interview.secondaryRecordingId) {
      const salvaged = await finalizeSecondaryRecording(interview.id);
      relativePath = salvaged.path;
    }
    if (!relativePath) {
      return Response.json({ error: "No recording available" }, { status: 404 });
    }
    const verified = await verifyStoredFile(relativePath);
    if (!verified.ok) {
      return Response.json({ error: "No recording available" }, { status: 404 });
    }

    let buf: Buffer;
    try {
      buf = await readStoredFile(relativePath);
    } catch {
      return Response.json({ error: "No recording available" }, { status: 404 });
    }
    const mime =
      interview.secondaryRecordingMime ??
      (relativePath.endsWith(".mp4") ? "video/mp4" : "video/webm");

    const download =
      new URL(request.url).searchParams.get("download") === "1";
    const disposition = download
      ? `attachment; filename="secondary-${interview.id}.webm"`
      : `inline; filename="secondary-${interview.id}.webm"`;

    const range = request.headers.get("range");
    const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : buf.length - 1;
      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end >= start &&
        start < buf.length
      ) {
        const clampedEnd = Math.min(end, buf.length - 1);
        const slice = buf.subarray(start, clampedEnd + 1);
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(slice.length),
            "Content-Range": `bytes ${start}-${clampedEnd}/${buf.length}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-store",
            "Content-Disposition": disposition,
          },
        });
      }
    }

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buf.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": disposition,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
