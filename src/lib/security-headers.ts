/**
 * R-1 — production security headers.
 *
 * HireOS is fully self-hosted: there is not a single third-party script,
 * style, font or API origin in the bundle (`next/font` self-hosts Inter at
 * build time, MediaPipe WASM is vendored under /mediapipe). That makes a tight
 * `'self'`-based policy realistic rather than aspirational.
 *
 * What the policy must not break, and why each allowance exists:
 *
 *   'wasm-unsafe-eval'  MediaPipe tasks-vision instantiates vision_wasm_internal.wasm
 *                       for the face/pose/object detectors. Without it the whole
 *                       secondary-camera pipeline dies at FilesetResolver.
 *   img-src data:       The secondary-camera pairing QR is a data: URL
 *                       (QRCode.toDataURL in enhanced-proctoring-setup).
 *   media-src blob:     Recorded chunks and TTS previews are played from
 *                       URL.createObjectURL().
 *   style 'unsafe-inline'
 *                       Next streams inline <style> for critical CSS and React
 *                       renders `style` attributes. A nonce does not cover
 *                       style attributes, so this cannot be removed without
 *                       rewriting component styling.
 *   dev 'unsafe-eval' + ws:
 *                       React Refresh evaluates modules and HMR uses a
 *                       websocket. Production gets neither.
 *
 * Scripts are nonce-based: Next stamps the nonce from this header onto its own
 * inline bootstrap scripts, so no 'unsafe-inline' is needed in production.
 */

export type SecurityContext = {
  /** NODE_ENV === "production" */
  isProduction: boolean;
  /** The *request* arrived over TLS (direct or via x-forwarded-proto). */
  isHttps: boolean;
  nonce: string;
};

/** Six months. Long enough to be meaningful, short enough to back out of. */
const HSTS_MAX_AGE = 15_552_000;

/** Per-request nonce. Web Crypto so this also runs on the edge runtime. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function buildContentSecurityPolicy(ctx: SecurityContext): string {
  const script = ["'self'", `'nonce-${ctx.nonce}'`, "'wasm-unsafe-eval'"];
  const connect = ["'self'"];

  if (!ctx.isProduction) {
    // React Refresh evaluates freshly compiled modules; HMR needs its socket.
    script.push("'unsafe-eval'");
    connect.push("ws:", "wss:");
  }

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["media-src", ["'self'", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connect],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];

  const parts = directives.map(([name, sources]) => `${name} ${sources.join(" ")}`);

  // Only meaningful once the page itself is HTTPS. Emitting it on a plain-HTTP
  // LAN pilot would rewrite every subresource to https:// and break the app.
  if (ctx.isHttps) parts.push("upgrade-insecure-requests");

  return parts.join("; ");
}

export function buildSecurityHeaders(ctx: SecurityContext): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildContentSecurityPolicy(ctx),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // The interview room needs camera + mic on its own origin; nothing else does.
    "Permissions-Policy": [
      "camera=(self)",
      "microphone=(self)",
      "display-capture=(self)",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),
  };

  if (ctx.isHttps) {
    headers["Strict-Transport-Security"] = `max-age=${HSTS_MAX_AGE}; includeSubDomains`;
  }

  return headers;
}

/**
 * Applied by next.config to the asset paths the middleware matcher skips
 * (anything containing a dot: /_next/static/**, /mediapipe/**).
 *
 * Deliberately excludes CSP — that is per-request because of the nonce, and
 * emitting it here too would send the header twice.
 */
export const STATIC_ASSET_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** True when the original client request used TLS, honouring the LAN proxy. */
export function requestIsHttps(input: {
  forwardedProto?: string | null;
  url?: string | null;
}): boolean {
  const proto = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  if (input.url) {
    try {
      return new URL(input.url).protocol === "https:";
    } catch {
      return false;
    }
  }
  return false;
}
