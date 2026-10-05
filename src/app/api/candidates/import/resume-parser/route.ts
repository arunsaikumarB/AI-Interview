import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AuthError, requireOrganizationId, requireRoles } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError, jsonOk } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import {
  IMPORT_MAX_BYTES,
  IMPORT_ROLES,
  ImportFileError,
  mappingSchema,
  readCsvTable,
  runResumeParserImport,
  suggestMapping,
} from "@/lib/resume-parser-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES = ["columns", "validate", "import"] as const;
type Mode = (typeof MODES)[number];
const SAMPLE_ROWS = 3;
const SAMPLE_CELL_CHARS = 80;

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Resume Parser CSV export → HireOS candidates/applications. Multipart form:
 * file (.csv), mode (columns | validate | import), mapping (JSON, for validate/import).
 * Organization and importing user come from the session only.
 */
export async function POST(request: Request) {
  let mode: Mode | null = null;
  try {
    const user = requireRoles(await getSession(), IMPORT_ROLES);
    const organizationId = requireOrganizationId(user);

    const rl = rateLimit({ key: `resume-parser-import:${user.id}`, limit: 30, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) return noStore(jsonError("Too many import requests. Wait a few minutes and try again.", 429));

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return noStore(jsonError("Upload a CSV file.", 400));
    }
    const rawMode = form.get("mode");
    mode = MODES.find((m) => m === rawMode) ?? null;
    if (!mode) return noStore(jsonError("Unknown action.", 400));

    const file = form.get("file");
    if (!(file instanceof File)) return noStore(jsonError("Choose the CSV file exported from Resume Parser.", 400));
    if (!/\.csv$/i.test(file.name)) {
      return noStore(jsonError("Only .csv files are supported. In Excel, use Save As \"CSV UTF-8 (Comma delimited)\".", 400));
    }
    if (file.size > IMPORT_MAX_BYTES) {
      return noStore(jsonError(`The file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`, 400));
    }

    const { header, rows } = readCsvTable(new Uint8Array(await file.arrayBuffer()));

    if (mode === "columns") {
      return noStore(
        jsonOk({
          header,
          rowCount: rows.length,
          sample: rows.slice(0, SAMPLE_ROWS).map((r) => header.map((_, i) => (r[i] ?? "").slice(0, SAMPLE_CELL_CHARS))),
          suggested: suggestMapping(header),
        }),
      );
    }

    let mappingJson: unknown;
    try {
      mappingJson = JSON.parse(String(form.get("mapping") ?? ""));
    } catch {
      return noStore(jsonError("Choose which column holds each field.", 400));
    }
    const parsed = mappingSchema.safeParse(mappingJson);
    if (!parsed.success) return noStore(jsonError("Choose which column holds each field.", 400));

    const report = await runResumeParserImport({
      prisma,
      organizationId,
      userId: user.id,
      header,
      rows,
      mapping: parsed.data,
      apply: mode === "import",
    });
    return noStore(jsonOk(report));
  } catch (err) {
    if (err instanceof ImportFileError) return noStore(jsonError(err.message, 400));
    if (err instanceof AuthError || err instanceof ZodError || isDatabaseUnavailable(err)) {
      return noStore(handleApiError(err));
    }
    console.error("[resume-parser-import] failed", {
      mode,
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return noStore(
      jsonError(
        mode === "import" ? "The import failed. Nothing was saved." : "The file could not be checked. Try again.",
        500,
      ),
    );
  }
}
