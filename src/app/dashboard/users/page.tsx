import { redirect } from "next/navigation";

/** Legacy route — admin console lives at /dashboard/admin */
export default function UsersRedirectPage() {
  redirect("/dashboard/admin");
}
