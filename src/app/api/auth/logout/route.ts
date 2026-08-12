import { clearSessionCookie } from "@/lib/auth/session";
import { jsonOk } from "@/lib/api";

export async function POST() {
  await clearSessionCookie();
  return jsonOk({ ok: true });
}
