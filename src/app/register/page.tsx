import RegisterScreen from "./register-screen";

/** R-1: see login/page.tsx — the nonce'd CSP requires per-request rendering. */
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return <RegisterScreen />;
}
