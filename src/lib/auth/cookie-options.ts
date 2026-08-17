/**
 * R-10 — session cookie attributes.
 *
 * Kept as a pure function so the Secure rule is testable without a request.
 *
 * The rule is deliberately "HTTPS **or** production" rather than just
 * `NODE_ENV === "production"`:
 *
 *   - Production stays Secure even behind a proxy that omits
 *     x-forwarded-proto, so a misconfigured deployment cannot silently
 *     downgrade the cookie.
 *   - The LAN pilot (scripts/lan-https-proxy.mjs, https://<LAN>:3443) runs a
 *     development build over real TLS. Before this change that connection
 *     issued a non-Secure session cookie.
 *   - Plain-HTTP localhost development stays non-Secure, because a Secure
 *     cookie over http:// is simply dropped and login would break.
 */

export type CookieContext = {
  isProduction: boolean;
  isHttps: boolean;
  ttlHours: number;
  /** Build the options used to expire the cookie rather than set it. */
  expire?: boolean;
};

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
  domain?: string;
};

export function sessionCookieOptions(ctx: CookieContext): SessionCookieOptions {
  return {
    httpOnly: true,
    // Lax rather than Strict: the candidate arrives on a magic link, which is
    // a cross-site top-level navigation. Strict would drop the cookie there.
    sameSite: "lax",
    secure: ctx.isHttps || ctx.isProduction,
    path: "/",
    maxAge: ctx.expire ? 0 : ctx.ttlHours * 60 * 60,
  };
}
