import { z, ZodError } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, requireOrganizationId, requireRoles } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import {
  UPLOAD_BATCH_MAX_BYTES,
  UPLOAD_BATCH_MAX_FILES,
  UPLOAD_ROLES,
  uploadRowSchema,
} from "@/lib/resume-upload/constants";
import { readUploadedResume, saveUploadedResume, type ReadResult, type SaveResult } from "@/lib/resume-upload/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobIdSchema = z.string().min(1).max(64);

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function logFailure(where: string, err: unknown) {
  console.error(`[upload-resumes] ${where}`, {
    name: err instanceof Error ? err.name : typeof err,
    code: (err as { code?: unknown } | null)?.code,
  });
}

/**
 * Resume PDFs uploaded by HR, one candidate per file.
 * mode=read: files → suggested name/email/phone/experience per file, nothing saved.
 * mode=save: files + reviewed rows → candidates (and applications when a job is chosen).
 * Up to 20 files / 40 MB per request.
 */
export async function POST(request: Request) {
  try {
    const user = requireRoles(await getSession(), UPLOAD_ROLES);
    const organizationId = requireOrganizationId(user);

    const rl = rateLimit({ key: `upload-resumes:${user.id}`, limit: 200, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return noStore(jsonError("Too many uploads. Wait a few minutes and try again.", 429));

    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > UPLOAD_BATCH_MAX_BYTES + 1024 * 1024) {
      return noStore(jsonError("Upload resumes in smaller batches.", 413));
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return noStore(jsonError("Choose the resume files to upload.", 400));
    }
    const mode = form.get("mode");
    if (mode !== "read" && mode !== "save") return noStore(jsonError("Unknown action.", 400));

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0 || files.length > UPLOAD_BATCH_MAX_FILES) {
      return noStore(jsonError(`Send between 1 and ${UPLOAD_BATCH_MAX_FILES} files per batch.`, 400));
    }
    if (files.reduce((sum, f) => sum + f.size, 0) > UPLOAD_BATCH_MAX_BYTES) {
      return noStore(jsonError("Upload resumes in smaller batches.", 413));
    }

    let jobId: string | null = null;
    const rawJob = form.get("jobId");
    if (typeof rawJob === "string" && rawJob !== "") {
      const parsed = jobIdSchema.safeParse(rawJob);
      const job = parsed.success
        ? await prisma.job.findFirst({
            where: { id: parsed.data, organizationId, status: { not: "CLOSED" } },
            select: { id: true },
          })
        : null;
      if (!job) return noStore(jsonError("Choose a job from the list.", 400));
      jobId = job.id;
    }

    const { extractResumeText } = await import("@/lib/resume/parse");

    if (mode === "read") {
      const results: ReadResult[] = [];
      for (const file of files) {
        results.push(
          await readUploadedResume(prisma, {
            organizationId,
            jobId,
            name: file.name,
            type: file.type,
            buffer: Buffer.from(await file.arrayBuffer()),
            deps: { extractText: extractResumeText },
          }),
        );
      }
      return noStore(jsonOk({ results }));
    }

    let rows: z.infer<typeof uploadRowSchema>[];
    try {
      rows = z.array(uploadRowSchema).length(files.length).parse(JSON.parse(String(form.get("rows") ?? "")));
    } catch {
      return noStore(jsonError("Some details are missing or not valid. Check the table and try again.", 400));
    }
    if (rows.some((row, i) => row.fileName !== files[i].name)) {
      return noStore(jsonError("The files and the table do not match. Select the files again.", 400));
    }

    const { embedCandidate } = await import("@/lib/ai/embeddings");
    const results: SaveResult[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        results.push(
          await saveUploadedResume(prisma, {
            organizationId,
            jobId,
            row: rows[i],
            type: file.type,
            buffer: Buffer.from(await file.arrayBuffer()),
            deps: { extractText: extractResumeText, embed: embedCandidate },
          }),
        );
      } catch (err) {
        if (isDatabaseUnavailable(err)) throw err;
        logFailure("file failed", err);
        results.push({ name: file.name, status: "failed", reason: "could not be saved; try again" });
      }
    }
    return noStore(jsonOk({ results }));
  } catch (err) {
    if (err instanceof AuthError || err instanceof ZodError || isDatabaseUnavailable(err)) {
      return noStore(handleApiError(err));
    }
    logFailure("failed", err);
    return noStore(jsonError("The upload failed. Try again.", 500));
  }
}
