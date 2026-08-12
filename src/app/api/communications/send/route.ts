import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  canManagePipeline,
  orgScopeWhere,
  requireStaff,
} from "@/lib/auth/rbac";
import { handleApiError, jsonCreated } from "@/lib/api";
import { sendMail } from "@/lib/mail";
import { hasMissingMarkers } from "@/lib/templates";
import { asJson } from "@/lib/ai/interview-session";

const bodySchema = z.object({
  candidateId: z.string().min(1),
  templateId: z.string().optional().nullable(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  applicationId: z.string().optional().nullable(),
});

/**
 * Explicit recruiter send. Never auto-sends. No cloud ESP.
 * SMTP when configured; otherwise DRAFT + clipboard mode.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    const user = requireStaff(session);
    if (!canManagePipeline(user.role)) {
      return Response.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const body = bodySchema.parse(await request.json());
    if (hasMissingMarkers(body.subject) || hasMissingMarkers(body.body)) {
      return Response.json(
        {
          error: "Resolve missing template variables before sending",
          missingBlocked: true,
        },
        { status: 400 },
      );
    }

    const scope = orgScopeWhere(user);
    const candidate = await prisma.candidate.findFirst({
      where: {
        id: body.candidateId,
        ...(scope.organizationId
          ? { organizationId: scope.organizationId }
          : {}),
      },
    });
    if (!candidate) {
      return Response.json({ error: "Candidate not found" }, { status: 404 });
    }

    if (body.templateId) {
      const template = await prisma.emailTemplate.findFirst({
        where: {
          id: body.templateId,
          organizationId: candidate.organizationId,
        },
      });
      if (!template) {
        return Response.json({ error: "Template not found" }, { status: 404 });
      }
    }

    if (body.applicationId) {
      const app = await prisma.application.findFirst({
        where: {
          id: body.applicationId,
          candidateId: candidate.id,
        },
      });
      if (!app) {
        return Response.json({ error: "Application not found" }, { status: 404 });
      }
    }

    const result = await sendMail({
      to: candidate.email,
      subject: body.subject,
      body: body.body,
    });

    if (result.mode === "clipboard") {
      const log = await prisma.communicationLog.create({
        data: {
          templateId: body.templateId ?? null,
          actorId: user.id,
          toAddress: candidate.email,
          channel: "EMAIL",
          status: "DRAFT",
          subject: body.subject,
          body: body.body,
          meta: asJson({
            mode: "clipboard",
            candidateId: candidate.id,
            applicationId: body.applicationId ?? null,
            advisoryOnly: true,
          }),
        },
      });

      if (body.applicationId) {
        await prisma.timelineEvent.create({
          data: {
            applicationId: body.applicationId,
            type: "EMAIL_SENT",
            payload: {
              communicationLogId: log.id,
              mode: "clipboard",
              status: "DRAFT",
              subject: body.subject,
              toAddress: candidate.email,
              actorId: user.id,
              note: "Clipboard draft — recruiter copies manually",
            },
          },
        });
      }

      return jsonCreated({
        log,
        mode: "clipboard",
        copy: { subject: body.subject, body: body.body },
      });
    }

    if (!result.ok) {
      const log = await prisma.communicationLog.create({
        data: {
          templateId: body.templateId ?? null,
          actorId: user.id,
          toAddress: candidate.email,
          channel: "EMAIL",
          status: "FAILED",
          subject: body.subject,
          body: body.body,
          meta: asJson({
            mode: "smtp",
            error: result.error,
            candidateId: candidate.id,
            applicationId: body.applicationId ?? null,
          }),
        },
      });
      return Response.json(
        { error: result.error, log, mode: "smtp" },
        { status: 502 },
      );
    }

    const sentAt = new Date();
    const log = await prisma.communicationLog.create({
      data: {
        templateId: body.templateId ?? null,
        actorId: user.id,
        toAddress: candidate.email,
        channel: "EMAIL",
        status: "SENT",
        subject: body.subject,
        body: body.body,
        sentAt,
        meta: asJson({
          mode: "smtp",
          messageId: result.messageId ?? null,
          candidateId: candidate.id,
          applicationId: body.applicationId ?? null,
        }),
      },
    });

    if (body.applicationId) {
      await prisma.timelineEvent.create({
        data: {
          applicationId: body.applicationId,
          type: "EMAIL_SENT",
          payload: {
            communicationLogId: log.id,
            mode: "smtp",
            status: "SENT",
            subject: body.subject,
            toAddress: candidate.email,
            actorId: user.id,
          },
        },
      });
    }

    return jsonCreated({ log, mode: "smtp" });
  } catch (err) {
    return handleApiError(err);
  }
}
