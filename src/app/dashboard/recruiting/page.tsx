import { redirect } from "next/navigation";

/** Jobs & Candidates hub — land on Jobs; subnav reaches Candidates + Pipeline. */
export default function RecruitingHubPage() {
  redirect("/dashboard/jobs");
}
