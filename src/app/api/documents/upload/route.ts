import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonCreated } from "@/lib/api";
import { saveUpload } from "@/lib/storage";
import { extractResumeText } from "@/lib/resume/parse";
import { embedCandidate } from "@/lib/ai/embeddings";
import {
  isAllowedResumeFile,
  resumeMimeError,
  RESUME_MAX_BYTES,
} from "@/lib/resume/mime";

/**
 * Staff resume upload + parse. Candidates use PUT /api/portal/profile.
 * CANDIDATE JWT → 403.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const form = await request.formData();
    const file = form.get("file");
    const applicationId = String(form.get("applicationId") ?? "") || null;
    const candidateIdParam = String(form.get("candidateId") ?? "") || null;

    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > RESUME_MAX_BYTES || !isAllowedResumeFile(file)) {
      return Response.json({ error: resumeMimeError() }, { status: 400 });
    }

    let candidateId: string | null = null;

    if (applicationId) {
      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: { job: true, candidate: true },
      });
      if (!application) {
        return Response.json({ error: "Application not found" }, { status: 404 });
      }

      const staffOk =
        canManagePipeline(user.role) &&
        (user.role === "SUPER_ADMIN" ||
          application.job.organizationId === user.organizationId);

      if (!staffOk) {
        throw new AuthError("Insufficient permissions", 403);
      }
      candidateId = application.candidateId;
    } else if (candidateIdParam && canManagePipeline(user.role)) {
      candidateId = candidateIdParam;
    } else {
      throw new AuthError("candidateId or applicationId required", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await saveUpload({
      category: "resumes",
      originalName: file.name,
      data: buffer,
    });

    let resumeText: string | null = null;
    let parseError: string | null = null;
    try {
      resumeText = await extractResumeText({
        buffer,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name,
      });
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Parse failed";
    }

    const candidate = await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        resumeUrl: stored.relativePath,
        ...(resumeText ? { resumeText } : {}),
      },
    });

    if (resumeText) {
      try {
        await embedCandidate(candidate.id);
      } catch (err) {
        console.warn(
          "[upload] embedCandidate failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (applicationId) {
      await prisma.timelineEvent.create({
        data: {
          applicationId,
          type: "DOCUMENT_UPLOADED",
          payload: {
            fileName: stored.fileName,
            parsed: Boolean(resumeText),
            parseError,
          },
        },
      });
    }

    return jsonCreated({
      candidate: {
        id: candidate.id,
        resumeUrl: candidate.resumeUrl,
        resumeTextLength: candidate.resumeText?.length ?? 0,
      },
      parsed: Boolean(resumeText),
      parseError,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
