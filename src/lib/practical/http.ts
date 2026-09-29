import { AuthError } from "@/lib/auth/rbac";
import { handleApiError, isDatabaseUnavailable, jsonError } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { hashAccessToken } from "./token";
import { PracticalError } from "./service";

export class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BodyError";
  }
}

/** JSON only, size-bounded before parsing. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) throw new BodyError(415, "Content-Type must be application/json");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError(413, "Request body too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new BodyError(413, "Request body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError(400, "Malformed JSON");
  }
}

export function practicalErrorResponse(err: unknown, context: string): Response {
  if (err instanceof PracticalError) return jsonError(err.message, err.status, { code: err.code });
  if (err instanceof BodyError) return jsonError(err.message, err.status);
  if (err instanceof AuthError || isDatabaseUnavailable(err)) return handleApiError(err);
  console.error(`[practical] ${context} failed:`, err instanceof Error ? err.name : "unknown");
  return jsonError("Something went wrong. Please try again.", 500);
}

/** Candidate-side limiter keyed by token hash and client IP. Returns a 429 response when exceeded. */
export function limitCandidate(
  request: Request,
  token: string,
  action: string,
  perToken: { limit: number; windowMs: number },
  perIp: { limit: number; windowMs: number },
): Response | null {
  const tokenKey = hashAccessToken(token).slice(0, 24);
  const byToken = rateLimit({ key: `practical:${action}:t:${tokenKey}`, ...perToken });
  const byIp = rateLimit({ key: `practical:${action}:ip:${clientIp(request)}`, ...perIp });
  if (!byToken.ok || !byIp.ok) return jsonError("Too many requests. Please wait a moment and try again.", 429);
  return null;
}
