import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, canManagePipeline, orgScopeWhere, requireStaff } from "@/lib/auth/rbac";
import { handleApiError, jsonCreated } from "@/lib/api";
import { deleteStoredFile, saveUpload } from "@/lib/storage";
import { embedCandidate } from "@/lib/ai/embeddings";
import {
  isAllowedResumeFile,
  resumeMimeError,
  RESUME_MAX_BYTES,
} from "@/lib/resume/mime";
import { enqueueDjangoJob } from "@/lib/staff-async/enqueue";
import { useDjangoAsync } from "@/lib/staff-async/flag";
import { djangoReadToResponse } from "@/lib/staff-reads/errors";

const idSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

const PARSE_FAILED = "Text could not be extracted from this file. The resume file is stored.";

function formId(form: FormData, key: string): string | null | undefined {
  const raw = form.get(key);
  if (raw === null || raw === "") return null;
  const parsed = idSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Staff resume upload + parse. Candidates use PUT /api/portal/profile.
 * CANDIDATE JWT → 403. The target candidate must belong to the caller's organization;
 * ownership is checked before anything is written to disk or the database.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    const scope = orgScopeWhere(user);
    const form = await request.formData();
    const file = form.get("file");
    const applicationId = formId(form, "applicationId");
    const candidateIdParam = formId(form, "candidateId");

    if (applicationId === undefined || candidateIdParam === undefined) {
      return Response.json({ error: "Invalid candidateId or applicationId" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > RESUME_MAX_BYTES || !isAllowedResumeFile(file)) {
      return Response.json({ error: resumeMimeError() }, { status: 400 });
    }
    if (!applicationId && !candidateIdParam) {
      throw new AuthError("candidateId or applicationId required", 400);
    }
    if (!canManagePipeline(user.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }

    let candidateId: string;
    if (applicationId) {
      const application = await prisma.application.findFirst({
        where: {
          id: applicationId,
          ...(scope.organizationId
            ? {
                job: { organizationId: scope.organizationId },
                candidate: { organizationId: scope.organizationId },
              }
            : {}),
        },
        select: { candidateId: true },
      });
      if (!application) {
        return Response.json({ error: "Application not found" }, { status: 404 });
      }
      candidateId = application.candidateId;
    } else {
      const candidate = await prisma.candidate.findFirst({
        where: { id: candidateIdParam!, ...scope },
        select: { id: true },
      });
      if (!candidate) {
        return Response.json({ error: "Candidate not found" }, { status: 404 });
      }
      candidateId = candidate.id;
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
        console.warn("[upload] resume text extraction failed:", err instanceof Error ? err.name : "unknown");
        parseError = PARSE_FAILED;
      }
    }

    let candidate;
    try {
      candidate = await prisma.candidate.update({
        where: { id: candidateId },
        data: {
          resumeUrl: stored.relativePath,
          ...(resumeText ? { resumeText } : {}),
        },
        select: { id: true, resumeText: true },
      });
    } catch (err) {
      await deleteStoredFile(stored.relativePath).catch(() => undefined);
      throw err;
    }

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
        resumeTextLength: candidate.resumeText?.length ?? 0,
      },
      parsed: Boolean(resumeText),
      parseError,
    });
  } catch (err) {
    return djangoReadToResponse(err) ?? handleApiError(err);
  }
}
