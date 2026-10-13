/**
 * Phone-side fetch for the secondary-camera pairing page. Every failure becomes a
 * candidate-readable message so the page can never sit on a blank/loading screen:
 * network drops, timeouts and proxy HTML error pages are retryable; invalid or
 * expired pairing codes are not. Never logs the URL (it carries the pairing code).
 */

export type SecondaryFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string; retryable: boolean };

export const SECONDARY_FETCH_TIMEOUT_MS = 15_000;

export const SECONDARY_NETWORK_MESSAGE =
  "Can't reach the interview server. Make sure this phone is on the same Wi‑Fi as the interview laptop, then try again.";
export const SECONDARY_TIMEOUT_MESSAGE =
  "The interview server is taking too long to respond. Check the Wi‑Fi connection, then try again.";
export const SECONDARY_SERVER_MESSAGE =
  "The interview server had a problem. Please try again in a moment.";
export const SECONDARY_NOT_FOUND_MESSAGE =
  "This pairing code is not valid. Scan the latest QR code shown on the interview laptop.";

function serverError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error.trim() : null;
}

export async function fetchSecondaryJson<T>(
  url: string,
  init?: RequestInit,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<SecondaryFetchResult<T>> {
  const { timeoutMs = SECONDARY_FETCH_TIMEOUT_MS, fetchImpl = fetch } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  let text: string;
  try {
    res = await fetchImpl(url, { ...init, cache: "no-store", signal: controller.signal });
    text = await res.text();
  } catch (err) {
    const timedOut = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    return {
      ok: false,
      status: null,
      message: timedOut ? SECONDARY_TIMEOUT_MESSAGE : SECONDARY_NETWORK_MESSAGE,
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  let isJson = false;
  if (text) {
    try {
      body = JSON.parse(text);
      isJson = true;
    } catch {
      body = null;
    }
  }

  if (res.ok) {
    if (isJson && body !== null && typeof body === "object") return { ok: true, data: body as T };
    // 200 with HTML usually means a proxy/captive-portal page, not the app.
    return { ok: false, status: res.status, message: SECONDARY_SERVER_MESSAGE, retryable: true };
  }

  if (res.status === 404) {
    return { ok: false, status: 404, message: SECONDARY_NOT_FOUND_MESSAGE, retryable: false };
  }
  if (res.status === 429 || res.status >= 500 || !isJson) {
    return { ok: false, status: res.status, message: SECONDARY_SERVER_MESSAGE, retryable: true };
  }
  return {
    ok: false,
    status: res.status,
    message: serverError(body) ?? "Secondary camera connection unavailable.",
    retryable: false,
  };
}
