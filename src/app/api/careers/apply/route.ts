import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handleApiError, jsonCreated, jsonOk } from "@/lib/api";
import { saveUpload } from "@/lib/storage";
import { extractResumeText } from "@/lib/resume/parse";
import { embedCandidate } from "@/lib/ai/embeddings";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  isAllowedResumeFile,
  resumeMimeError,
  RESUME_MAX_BYTES,
} from "@/lib/resume/mime";

/**
 * Public careers apply — no auth required.
 * Honeypot + IP rate limit; optional CANDIDATE account via password.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const rl = rateLimit({
      key: `careers-apply:${ip}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      return Response.json(
        { error: "Too many applications from this network. Try again later." },
        { status: 429 },
      );
    }

    const form = await request.formData();

    // Honeypot — bots fill hidden "website"; silently accept and drop.
    const honeypot = String(form.get("website") ?? "").trim();
    if (honeypot) {
      return jsonOk({ ok: true, dropped: true });
    }

    const parsed = z
      .object({
        jobId: z.string().min(1),
        firstName: z.string().min(1).max(80),
        lastName: z.string().min(1).max(80),
        email: z.string().email().max(200),
        phone: z.string().max(40).optional(),
        location: z.string().max(120).optional(),
        coverNote: z.string().max(5000).optional(),
        password: z.string().min(10).max(200).optional(),
      })
      .safeParse({
        jobId: String(form.get("jobId") ?? ""),
        firstName: String(form.get("firstName") ?? "").trim(),
        lastName: String(form.get("lastName") ?? "").trim(),
        email: String(form.get("email") ?? "").trim().toLowerCase(),
        phone: String(form.get("phone") ?? "").trim() || undefined,
        location: String(form.get("location") ?? "").trim() || undefined,
        coverNote: String(form.get("coverNote") ?? "").trim() || undefined,
        password: String(form.get("password") ?? "") || undefined,
      });

    if (!parsed.success) {
      return Response.json(
        { error: "Validation failed", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const body = parsed.data;
    const file = form.get("resume");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ error: "Resume is required" }, { status: 400 });
    }
    if (file.size > RESUME_MAX_BYTES) {
      return Response.json({ error: resumeMimeError() }, { status: 400 });
    }
    if (!isAllowedResumeFile(file)) {
      return Response.json({ error: resumeMimeError() }, { status: 400 });
    }

    const job = await prisma.job.findFirst({
      where: { id: body.jobId, status: "OPEN" },
    });
    if (!job) {
      return Response.json({ error: "Job is not open for applications" }, { status: 400 });
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

    let candidate = await prisma.candidate.findUnique({
      where: {
        organizationId_email: {
          organizationId: job.organizationId,
          email: body.email,
        },
      },
    });

    if (!candidate) {
      candidate = await prisma.candidate.create({
        data: {
          organizationId: job.organizationId,
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone,
          location: body.location,
          resumeUrl: stored.relativePath,
          ...(resumeText ? { resumeText } : {}),
        },
      });
    } else {
      candidate = await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone ?? candidate.phone,
          location: body.location ?? candidate.location,
          resumeUrl: stored.relativePath,
          ...(resumeText ? { resumeText } : {}),
        },
      });
    }

    let accountCreated = false;
    if (body.password) {
      const existingUser = await prisma.user.findUnique({
        where: { email: body.email },
      });
      if (existingUser) {
        if (existingUser.role !== "CANDIDATE") {
          return Response.json(
            {
              error:
                "An account with this email already exists. Sign in instead of creating a new password.",
            },
            { status: 409 },
          );
        }
        if (!candidate.userId) {
          await prisma.candidate.update({
            where: { id: candidate.id },
            data: { userId: existingUser.id },
          });
        }
      } else {
        const passwordHash = await bcrypt.hash(body.password, 12);
        const user = await prisma.user.create({
          data: {
            email: body.email,
            name: `${body.firstName} ${body.lastName}`.trim(),
            passwordHash,
            role: "CANDIDATE",
            organizationId: job.organizationId,
            isActive: true,
          },
        });
        await prisma.candidate.update({
          where: { id: candidate.id },
          data: { userId: user.id },
        });
        accountCreated = true;
      }
    }

    try {
      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          stage: "APPLIED",
          status: "ACTIVE",
          source: "careers_site",
          coverNote: body.coverNote,
          timelineEvents: {
            create: {
              type: "APPLICATION_CREATED",
              payload: {
                source: "careers_site",
                parsed: Boolean(resumeText),
                parseError,
                accountCreated,
              },
            },
          },
        },
      });

      if (resumeText) {
        try {
          await embedCandidate(candidate.id);
        } catch (err) {
          console.warn(
            "[careers/apply] embedCandidate failed:",
            err instanceof Error ? err.message : err,
          );
        }
      }

      return jsonCreated({
        ok: true,
        applicationId: application.id,
        accountCreated,
        alreadyApplied: false,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return Response.json(
          {
            error: "You have already applied to this role.",
            alreadyApplied: true,
          },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
