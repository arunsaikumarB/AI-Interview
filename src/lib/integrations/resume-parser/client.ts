import { RESUME_MAX_BYTES } from "@/lib/resume/mime";
import {
  resumeParserSearchResponseSchema,
  type ResumeParserPage,
  type ResumeParserResumeFile,
  type ResumeParserSearch,
} from "./types";

/**
 * Server-side boundary to the Resume Parser application. Server code only: the API key comes
 * from server env (never NEXT_PUBLIC_*) and never reaches the browser. Resume Parser stays the
 * source of truth for its profiles; HireOS never writes back.
 */
export interface ResumeParserClient {
  readonly configured: boolean;
  /** Server-side filtered, paginated skill search. */
  search(filters: ResumeParserSearch, page: number, pageSize: number): Promise<ResumeParserPage>;
  /** The stored resume file, or null when Resume Parser has none (404). */
  getResumeFile(profileId: number): Promise<ResumeParserResumeFile | null>;
}

export class ResumeParserNotConfiguredError extends Error {
  constructor() {
    super("The Resume Parser API is not connected yet.");
    this.name = "ResumeParserNotConfiguredError";
  }
}

/** Resume Parser could not be reached, timed out, rejected HireOS's key, or sent something unusable. */
export class ResumeParserUnavailableError extends Error {
  constructor(readonly reason: "unreachable" | "rejected_key" | "bad_request" | "bad_response" | "too_large") {
    super(`Resume Parser request failed: ${reason}`);
    this.name = "ResumeParserUnavailableError";
  }
}

const notConfigured = async (): Promise<never> => {
  throw new ResumeParserNotConfiguredError();
};

export const notConfiguredResumeParserClient: ResumeParserClient = {
  configured: false,
  search: notConfigured,
  getResumeFile: notConfigured,
};

const SEARCH_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SEARCH_MAX_BYTES = 2 * 1024 * 1024;
const LIST_MAX_ITEMS = 25;

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain",
};

/** http(s) origin plus optional path prefix, no credentials, query or fragment. */
export function parseResumeParserBaseUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function list(items: string[] | undefined): string | null {
  const cleaned = (items ?? []).map((s) => s.trim()).filter(Boolean).slice(0, LIST_MAX_ITEMS);
  return cleaned.length > 0 ? cleaned.join(",") : null;
}

export function searchQuery(filters: ResumeParserSearch, page: number, pageSize: number): URLSearchParams {
  const q = new URLSearchParams();
  const add = (key: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") q.set(key, String(value));
  };
  add("skills", list(filters.skills));
  add("any_skills", list(filters.anySkills));
  add("exclude_skills", list(filters.excludeSkills));
  add("min_experience", filters.minExperience);
  add("max_experience", filters.maxExperience);
  add("city", filters.city?.trim());
  add("state", filters.state?.trim());
  add("page", page);
  add("page_size", pageSize);
  return q;
}

/** Reads at most `max` bytes; larger bodies are cancelled instead of buffered. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new ResumeParserUnavailableError("too_large");
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
      throw new ResumeParserUnavailableError("too_large");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** The `filename` from Content-Disposition, reduced to a plain base name. */
export function dispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  let name: string | null = null;
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = null;
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(header);
    name = (plain?.[1] ?? plain?.[2] ?? "").trim() || null;
  }
  if (!name) return null;
  const base = name.split(/[\\/]/).pop()?.replace(/[\0-\x1f]/g, "").trim() ?? "";
  return base && base !== "." && base !== ".." ? base.slice(0, 255) : null;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function createHttpResumeParserClient(opts: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): ResumeParserClient {
  const doFetch = opts.fetchImpl ?? fetch;

  async function request(path: string, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method: "GET",
        headers: { "X-API-Key": opts.apiKey, Accept: "application/json, */*" },
        // A redirect would carry the API key to another address.
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ResumeParserUnavailableError("unreachable");
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => undefined);
      throw new ResumeParserUnavailableError("rejected_key");
    }
    return res;
  }

  return {
    configured: true,

    async search(filters, page, pageSize) {
      const res = await request(`/api/v1/external/profiles/search/?${searchQuery(filters, page, pageSize)}`, SEARCH_TIMEOUT_MS);
      if (res.status === 400) {
        await res.body?.cancel().catch(() => undefined);
        throw new ResumeParserUnavailableError("bad_request");
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new ResumeParserUnavailableError("unreachable");
      }
      let body: unknown;
      try {
        body = JSON.parse((await readCapped(res, SEARCH_MAX_BYTES)).toString("utf8"));
      } catch (err) {
        if (err instanceof ResumeParserUnavailableError) throw err;
        throw new ResumeParserUnavailableError("bad_response");
      }
      const parsed = resumeParserSearchResponseSchema.safeParse(body);
      if (!parsed.success) throw new ResumeParserUnavailableError("bad_response");
      return {
        profiles: parsed.data.results,
        total: parsed.data.count,
        page: parsed.data.page,
        pageSize: parsed.data.page_size,
        totalPages: parsed.data.total_pages,
      };
    },

    async getResumeFile(profileId) {
      if (!Number.isSafeInteger(profileId) || profileId <= 0) return null;
      const res = await request(`/api/v1/external/profiles/${profileId}/resume/`, DOWNLOAD_TIMEOUT_MS);
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new ResumeParserUnavailableError("unreachable");
      }
      const data = await readCapped(res, RESUME_MAX_BYTES);
      const fileName = dispositionFileName(res.headers.get("content-disposition"));
      const headerType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const mimeType = (fileName && MIME_BY_EXT[extOf(fileName)]) || headerType || "application/octet-stream";
      return { fileName, mimeType, data };
    },
  };
}

/** Real client when RESUME_PARSER_API_URL and RESUME_PARSER_API_KEY are set; otherwise not configured. */
export function getResumeParserClient(env: Record<string, string | undefined> = process.env): ResumeParserClient {
  const baseUrl = parseResumeParserBaseUrl(env.RESUME_PARSER_API_URL);
  const apiKey = env.RESUME_PARSER_API_KEY?.trim();
  if (!baseUrl || !apiKey) return notConfiguredResumeParserClient;
  return createHttpResumeParserClient({ baseUrl, apiKey });
}
