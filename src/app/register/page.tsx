import { redirect } from "next/navigation";
import { candidateAccountsEnabled } from "@/lib/auth/candidate-accounts";
import RegisterScreen from "./register-screen";

/** R-1: see login/page.tsx — the nonce'd CSP requires per-request rendering. */
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  if (!candidateAccountsEnabled()) redirect("/login");
  return <RegisterScreen />;
}
