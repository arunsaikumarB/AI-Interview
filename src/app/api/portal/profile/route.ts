import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { requireCandidate } from "@/lib/auth/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { embedCandidate } from "@/lib/ai/embeddings";
import { saveUpload } from "@/lib/storage";
import { extractResumeText } from "@/lib/resume/parse";
import {
  isAllowedResumeFile,
  resumeMimeError,
  RESUME_MAX_BYTES,
} from "@/lib/resume/mime";

const patchSchema = z.object({
  phone: z.string().max(40).optional().nullable(),
  location: z.string().max(120).optional().nullable(),
  summary: z.string().max(5000).optional().nullable(),
});

function publicProfile(c: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  location: string | null;
  summary: string | null;
  resumeUrl: string | null;
  resumeText: string | null;
}) {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    location: c.location,
    summary: c.summary,
    hasResume: Boolean(c.resumeUrl),
    resumeTextLength: c.resumeText?.length ?? 0,
  };
}

export async function GET() {
  try {
    const session = await getSession();
    const user = requireCandidate(session);
    const candidate = await prisma.candidate.findUnique({
      where: { userId: user.id },
    });
    if (!candidate) {
      return Response.json({ error: "Candidate profile not found" }, { status: 404 });
    }
    return jsonOk({ profile: publicProfile(candidate) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    const user = requireCandidate(session);
    const body = patchSchema.parse(await request.json());

    const existing = await prisma.candidate.findUnique({
      where: { userId: user.id },
    });
    if (!existing) {
      return Response.json({ error: "Candidate profile not found" }, { status: 404 });
    }

    const profile = await prisma.candidate.update({
      where: { id: existing.id },
      data: {
        phone: body.phone === undefined ? undefined : body.phone,
        location: body.location === undefined ? undefined : body.location,
        summary: body.summary === undefined ? undefined : body.summary,
      },
    });

    if (body.summary !== undefined) {
      try {
        await embedCandidate(profile.id);
      } catch (err) {
        console.warn(
          "[portal/profile] embedCandidate failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return jsonOk({ profile: publicProfile(profile) });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Re-upload resume — parse + re-embed. */
export async function PUT(request: Request) {
  try {
    const session = await getSession();
    const user = requireCandidate(session);

    const existing = await prisma.candidate.findUnique({
      where: { userId: user.id },
    });
    if (!existing) {
      return Response.json({ error: "Candidate profile not found" }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("resume");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ error: "Resume is required" }, { status: 400 });
    }
    if (file.size > RESUME_MAX_BYTES || !isAllowedResumeFile(file)) {
      return Response.json({ error: resumeMimeError() }, { status: 400 });
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

    const profile = await prisma.candidate.update({
      where: { id: existing.id },
      data: {
        resumeUrl: stored.relativePath,
        ...(resumeText ? { resumeText } : {}),
      },
    });

    if (resumeText) {
      try {
        await embedCandidate(profile.id);
      } catch (err) {
        console.warn(
          "[portal/profile] resume embed failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return jsonOk({
      profile: publicProfile(profile),
      parsed: Boolean(resumeText),
      parseError,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
