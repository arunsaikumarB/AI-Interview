import LoginScreen from "./login-screen";

/**
 * R-1: server wrapper so this route renders per request.
 *
 * The production CSP is nonce-based with no 'unsafe-inline'. Next only stamps
 * the nonce onto its inline bootstrap scripts when a route is rendered
 * dynamically — a statically pre-rendered page is baked at build time with no
 * nonce, so every inline script on it (theme init, RSC payload, hydration)
 * would be blocked. `export const dynamic` is ignored inside a "use client"
 * module, hence this wrapper; the screen itself is unchanged.
 */
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginScreen />;
}
