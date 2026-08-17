import { cookies } from "next/headers";
import { djangoApiUrl } from "./flag";
import { DjangoReadError } from "./errors";

const AUTH_COOKIE = () => process.env.AUTH_COOKIE_NAME ?? "aros_session";

export function sessionCookieHeader(request?: Request): string {
  const fromRequest = request?.headers.get("cookie");
  if (fromRequest) return fromRequest;
  const token = cookies().get(AUTH_COOKIE())?.value;
  return token ? `${AUTH_COOKIE()}=${token}` : "";
}

type Query = Record<string, string | number | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path.replace(/^\//, "/"), `${djangoApiUrl()}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseDjangoErrorBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const rec = body as Record<string, unknown>;
  if (typeof rec.error === "string") return rec.error;
  if (typeof rec.detail === "string") return rec.detail;
  if (Array.isArray(rec.detail) && typeof rec.detail[0] === "string") {
    return rec.detail[0];
  }
  return fallback;
}

export async function djangoGetJson<T>(
  path: string,
  opts?: { request?: Request; query?: Query },
): Promise<T> {
  const cookie = sessionCookieHeader(opts?.request);
  const url = buildUrl(path, opts?.query);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Django unreachable";
    console.error("[staff-reads] Django GET failed (network)", path, msg);
    throw new DjangoReadError("Staff read service unavailable", 503);
  }

  if (!res.ok) {
    let message = `Staff read failed (${res.status})`;
    try {
      message = parseDjangoErrorBody(await res.json(), message);
    } catch {
      /* keep default */
    }
    console.error("[staff-reads] Django GET failed", path, res.status, message);
    throw new DjangoReadError(message, res.status);
  }

  return (await res.json()) as T;
}

async function djangoSendJson<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: Record<string, unknown> | undefined,
  opts?: { request?: Request; timeoutMs?: number },
): Promise<T> {
  const cookie = sessionCookieHeader(opts?.request);
  const url = buildUrl(path);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Django unreachable";
    console.error("[django] network failed", method, path, msg);
    throw new DjangoReadError(
      method === "POST" ? "Staff action service unavailable" : "Staff write service unavailable",
      503,
    );
  }

  if (!res.ok) {
    let message = `Staff action failed (${res.status})`;
    try {
      message = parseDjangoErrorBody(await res.json(), message);
    } catch {
      /* keep default */
    }
    console.error("[django]", method, "failed", path, res.status, message);
    throw new DjangoReadError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function djangoPostJson<T>(
  path: string,
  body: Record<string, unknown>,
  opts?: { request?: Request; timeoutMs?: number },
): Promise<T> {
  return djangoSendJson<T>("POST", path, body, opts);
}

export async function djangoPatchJson<T>(
  path: string,
  body: Record<string, unknown>,
  opts?: { request?: Request; timeoutMs?: number },
): Promise<T> {
  return djangoSendJson<T>("PATCH", path, body, opts);
}

export async function djangoDeleteJson<T>(
  path: string,
  opts?: { request?: Request; timeoutMs?: number },
): Promise<T> {
  return djangoSendJson<T>("DELETE", path, undefined, opts);
}

export async function djangoGetAllPages<T>(
  path: string,
  listKey: string,
  opts?: { request?: Request; query?: Query },
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  const pageSize = 100;
  const maxPages = 50;

  while (page <= maxPages) {
    const body = await djangoGetJson<Record<string, unknown>>(path, {
      request: opts?.request,
      query: { ...opts?.query, page, page_size: pageSize },
    });
    const batch = Array.isArray(body[listKey]) ? (body[listKey] as T[]) : [];
    items.push(...batch);
    const count = typeof body.count === "number" ? body.count : items.length;
    if (items.length >= count || batch.length === 0) break;
    page += 1;
  }

  return items;
}
