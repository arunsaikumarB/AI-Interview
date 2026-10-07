import { z } from "zod";
import { RESUME_MAX_BYTES } from "@/lib/resume/mime";
import { dispositionFileName, parseResumeParserBaseUrl } from "@/lib/integrations/resume-parser/client";

/**
 * Server-side boundary to the LogiSoft careers site (WordPress `careers/v1` API). Read-only:
 * HireOS never writes back. The Bearer key comes from server env (never NEXT_PUBLIC_*).
 */

export const CAREERS_PAGE_SIZE = 100;

const id = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z
    .string()
    .regex(/^\d{1,15}$/)
    .transform(Number)
    .refine((n) => n > 0),
]);

/** Free-text form answer: any scalar, kept as a string of bounded length. */
const text = (max: number) =>
  z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional()
    .transform((v) => (v === null || v === undefined || v === false ? "" : String(v)).slice(0, max));

export const careersApplicationSchema = z.object({
  application_id: id,
  applied_on: text(40),
  applicant_name: text(300),
  applicant_email: text(320),
  applicant_phone: text(60),
  job_id: id,
  job_title: text(400),
  cover_letter: text(20_000),
  total_experience: text(200),
  relevant_experience: text(200),
  skills_exposure: text(4_000),
  education: text(1_000),
  hometown: text(200),
  current_town: text(200),
  current_ctc: text(100),
  expected_ctc: text(100),
  notice_period: text(200),
  tentative_joining: text(200),
  interview_availability: text(500),
  reason_leaving: text(2_000),
  linkedin_url: text(500),
  resume_filename: text(300),
});

export type CareersApplication = z.infer<typeof careersApplicationSchema>;

const pageSchema = z.object({
  success: z.literal(true),
  page: z.coerce.number().int().min(1),
  total: z.coerce.number().int().min(0),
  total_pages: z.coerce.number().int().min(0),
  applications: z.array(z.unknown()).max(CAREERS_PAGE_SIZE),
});

export type CareersPage = {
  page: number;
  total: number;
  totalPages: number;
  applications: CareersApplication[];
  /** Rows that did not match the expected shape (skipped). */
  malformed: number;
};

export type CareersResumeFile = { fileName: string | null; mimeType: string; data: Buffer };

export interface CareersClient {
  /** One page of live applications; `after` ("YYYY-MM-DD HH:MM:SS", site time) limits it to newer ones. */
  listApplications(args: { page: number; after?: string | null }): Promise<CareersPage>;
  /** The applicant's resume, or null when the site has none (404, e.g. the job expired). */
  getResume(applicationId: number): Promise<CareersResumeFile | null>;
}

export class CareersUnavailableError extends Error {
  constructor(readonly reason: "unreachable" | "rejected_key" | "bad_request" | "bad_response" | "too_large") {
    super(`Careers site request failed: ${reason}`);
    this.name = "CareersUnavailableError";
  }
}

export type CareersConfig = { baseUrl: string; apiKey: string };

/** Null unless both CAREERS_API_URL and CAREERS_API_KEY are set and the URL is a plain http(s) address. */
export function parseCareersConfig(env: Record<string, string | undefined> = process.env): CareersConfig | null {
  const baseUrl = parseResumeParserBaseUrl(env.CAREERS_API_URL);
  const apiKey = env.CAREERS_API_KEY?.trim();
  if (!baseUrl || !apiKey || /\s/.test(apiKey)) return null;
  return { baseUrl, apiKey };
}

const LIST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const LIST_MAX_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain",
};

async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new CareersUnavailableError("too_large");
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new CareersUnavailableError("too_large");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function createHttpCareersClient(opts: CareersConfig & { fetchImpl?: typeof fetch }): CareersClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const api = `${opts.baseUrl}/wp-json/careers/v1/live-applications`;

  async function request(url: string, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json, */*" },
        // A redirect would carry the key to another address.
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CareersUnavailableError("unreachable");
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => undefined);
      throw new CareersUnavailableError("rejected_key");
    }
    return res;
  }

  return {
    async listApplications({ page, after }) {
      const q = new URLSearchParams({ page: String(page), per_page: String(CAREERS_PAGE_SIZE) });
      if (after) q.set("after", after);
      const res = await request(`${api}?${q}`, LIST_TIMEOUT_MS);
      if (res.status === 400) {
        await res.body?.cancel().catch(() => undefined);
        throw new CareersUnavailableError("bad_request");
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new CareersUnavailableError("unreachable");
      }
      let body: unknown;
      try {
        body = JSON.parse((await readCapped(res, LIST_MAX_BYTES)).toString("utf8"));
      } catch (err) {
        if (err instanceof CareersUnavailableError) throw err;
        throw new CareersUnavailableError("bad_response");
      }
      const parsed = pageSchema.safeParse(body);
      if (!parsed.success) throw new CareersUnavailableError("bad_response");
      const applications: CareersApplication[] = [];
      let malformed = 0;
      for (const row of parsed.data.applications) {
        const app = careersApplicationSchema.safeParse(row);
        if (app.success) applications.push(app.data);
        else malformed++;
      }
      return {
        page: parsed.data.page,
        total: parsed.data.total,
        totalPages: parsed.data.total_pages,
        applications,
        malformed,
      };
    },

    async getResume(applicationId) {
      if (!Number.isSafeInteger(applicationId) || applicationId <= 0) return null;
      const res = await request(`${api}/${applicationId}/resume`, DOWNLOAD_TIMEOUT_MS);
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new CareersUnavailableError("unreachable");
      }
      const data = await readCapped(res, RESUME_MAX_BYTES);
      const fileName = dispositionFileName(res.headers.get("content-disposition"));
      const headerType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const mimeType = (fileName && MIME_BY_EXT[extOf(fileName)]) || headerType || "application/octet-stream";
      return { fileName, mimeType, data };
    },
  };
}

export function getCareersClient(env: Record<string, string | undefined> = process.env): CareersClient | null {
  const config = parseCareersConfig(env);
  return config ? createHttpCareersClient(config) : null;
}
