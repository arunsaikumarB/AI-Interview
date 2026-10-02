import path from "node:path";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api";
import { readStoredFile, verifyStoredFile } from "@/lib/storage";
import { resumeFileName } from "@/lib/candidate-detail-ui";

type Ctx = { params: { id: string } };

const MIME_BY_EXT: Record<string, { type: string; inline: boolean }> = {
  ".pdf": { type: "application/pdf", inline: true },
  ".txt": { type: "text/plain; charset=utf-8", inline: true },
  ".docx": {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    inline: false,
  },
};

/**
 * Staff view/download of a candidate's stored resume — never a public /storage URL.
 * Same scope as GET /api/candidates/[id]: staff only, own organization. CANDIDATE → 403.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);

    const candidate = await prisma.candidate.findFirst({
      where: {
        id: params.id,
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      },
      select: { resumeUrl: true },
    });
    if (!candidate) {
      return Response.json({ error: "Candidate not found" }, { status: 404 });
    }

    const relativePath = candidate.resumeUrl?.replace(/\\/g, "/") ?? null;
    if (!relativePath || !relativePath.startsWith("resumes/")) {
      return Response.json({ error: "No resume available" }, { status: 404 });
    }
    if (!(await verifyStoredFile(relativePath)).ok) {
      return Response.json({ error: "Resume file is missing from storage" }, { status: 404 });
    }

    let buf: Buffer;
    try {
      buf = await readStoredFile(relativePath);
    } catch {
      return Response.json({ error: "Resume file is missing from storage" }, { status: 404 });
    }

    const ext = path.extname(relativePath).toLowerCase();
    const kind = MIME_BY_EXT[ext] ?? { type: "application/octet-stream", inline: false };
    const download = new URL(request.url).searchParams.get("download") === "1";
    const name = resumeFileName(relativePath);
    const asciiName = name.replace(/[^A-Za-z0-9._-]/g, "_") || `resume${ext}`;
    const disposition = `${download || !kind.inline ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`;

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": kind.type,
        "Content-Length": String(buf.length),
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
