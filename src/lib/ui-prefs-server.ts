import { cookies } from "next/headers";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/ui-prefs";

export function readSidebarCollapsed(): boolean {
  return cookies().get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
}
