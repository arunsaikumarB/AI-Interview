import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonCreated } from "@/lib/api";
import { saveUpload } from "@/lib/storage";
import { embedCandidate } from "@/lib/ai/embeddings";
import {
  isAllowedResumeFile,
  resumeMimeError,
  RESUME_MAX_BYTES,
} from "@/lib/resume/mime";
import { enqueueDjangoJob } from "@/lib/staff-async/enqueue";
import { useDjangoAsync } from "@/lib/staff-async/flag";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

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
    if (!useDjangoAsync()) {
      try {
        const { extractResumeText } = await import("@/lib/resume/parse");
        resumeText = await extractResumeText({
          buffer,
          mimeType: file.type || "application/octet-stream",
          fileName: file.name,
        });
      } catch (err) {
        parseError = err instanceof Error ? err.message : "Parse failed";
      }
    }

    const candidate = await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        resumeUrl: stored.relativePath,
        ...(resumeText ? { resumeText } : {}),
      },
    });

    if (useDjangoAsync()) {
      try {
        const queued = await enqueueDjangoJob(
          "/api/v1/resumes/process/",
          { candidate_id: candidate.id },
          "RESUME_PROCESSING",
          request,
        );
        if (applicationId) {
          await prisma.timelineEvent.create({
            data: {
              applicationId,
              type: "DOCUMENT_UPLOADED",
              payload: {
                fileName: stored.fileName,
                parsed: false,
                queued: true,
                task_id: queued.task_id,
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
          parsed: false,
          queued: true,
          ...queued,
        });
      } catch (err) {
        const mapped = djangoReadToResponse(err);
        if (mapped) {
          const payload = await mapped.json();
          return Response.json(
            {
              error:
                typeof payload.error === "string"
                  ? `${payload.error} File was stored but processing was not queued.`
                  : "File was stored but processing was not queued.",
            },
            { status: mapped.status },
          );
        }
        throw err;
      }
    }

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
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
