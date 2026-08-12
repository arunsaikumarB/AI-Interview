"use client";

import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import {
  CreateInterviewDialog,
  type CreateInterviewApplicationOption,
} from "@/components/create-interview-dialog";
import { ComposeEmailDialog } from "@/components/compose-email-dialog";
import { InterviewLinksToolbar } from "@/components/interview-links-toolbar";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  candidateInterviewUrl,
  interviewLinkDisplayStatus,
  type InterviewLinkDisplayStatus,
} from "@/lib/interview-links";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

export type InterviewLinkRow = {
  id: string;
  status: string;
  displayStatus: InterviewLinkDisplayStatus;
  interviewType: string;
  deliveryMode: string;
  accessToken: string;
  createdAt: string;
  tokenExpiresAt: string | null;
  candidateName: string;
  candidateId: string;
  jobTitle: string;
  applicationId: string;
  awaitingDecision: boolean;
};

function statusClass(status: InterviewLinkDisplayStatus): string {
  switch (status) {
    case "Active":
      return "bg-slate-100 text-slate-800";
    case "In Progress":
      return "bg-blue-50 text-blue-900";
    case "Completed":
      return "bg-emerald-50 text-emerald-900";
    case "Expired":
    case "Cancelled":
      return "bg-slate-50 text-slate-500";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function InterviewLinksPanel({
  rows,
  applications,
  createOpen = false,
  preselectedApplicationId,
  preselectedCandidateId,
  preselectedJobId,
}: {
  rows: InterviewLinkRow[];
  applications: CreateInterviewApplicationOption[];
  createOpen?: boolean;
  preselectedApplicationId?: string;
  preselectedCandidateId?: string;
  preselectedJobId?: string;
}) {
  const router = useRouter();
  const [emailFor, setEmailFor] = useState<{
    candidateId: string;
    applicationId: string;
  } | null>(null);

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(
      candidateInterviewUrl(token, window.location.origin),
    );
    toast.success("Link copied.");
  }

  async function expireLink(id: string) {
    const res = await fetch(`/api/interviews/${id}/expire`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not expire link");
      return;
    }
    toast.success("Interview link expired");
    router.refresh();
  }

  if (rows.length === 0 && !createOpen) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-slate-900">Interview Links</h1>
            <p className="mt-2 text-sm text-slate-500">
              Create and manage candidate interview links.
            </p>
          </div>
          <CreateInterviewDialog
            applications={applications}
            triggerLabel="+ Create Interview"
          />
        </div>
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <h2 className="text-lg font-semibold text-slate-900">Interview Links</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            No interview links yet.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Create an interview link to invite a candidate to an AI interview.
          </p>
          <div className="mt-6 flex justify-center">
            <CreateInterviewDialog
              applications={applications}
              triggerLabel="Create Interview"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-slate-900">Interview Links</h1>
          <p className="mt-2 text-sm text-slate-500">
            Create and manage candidate interview links.
          </p>
        </div>
        <CreateInterviewDialog
          applications={applications}
          triggerLabel="+ Create Interview"
          defaultOpen={createOpen}
          preselectedApplicationId={preselectedApplicationId}
          preselectedCandidateId={preselectedCandidateId}
          preselectedJobId={preselectedJobId}
        />
      </div>

      <Suspense fallback={null}>
        <InterviewLinksToolbar />
      </Suspense>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Candidate</th>
              <th className="px-4 py-3 font-medium">Job</th>
              <th className="px-4 py-3 font-medium">Interview</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const canCopy =
                r.displayStatus === "Active" || r.displayStatus === "In Progress";
              const canExpire =
                r.displayStatus === "Active" ||
                r.displayStatus === "In Progress" ||
                r.displayStatus === "Scheduled";
              const canReport = r.displayStatus === "Completed";
              const canOpen =
                canCopy || r.status === "SCHEDULED" || canReport;

              return (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {r.candidateName}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.jobTitle}</td>
                  <td className="px-4 py-3 text-slate-700">AI Interview</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
                        statusClass(r.displayStatus),
                      )}
                    >
                      {r.displayStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.tokenExpiresAt ? formatDate(r.tokenExpiresAt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "icon-sm" }),
                        )}
                        aria-label="Actions"
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canCopy ? (
                          <DropdownMenuItem onClick={() => copyLink(r.accessToken)}>
                            Copy Link
                          </DropdownMenuItem>
                        ) : null}
                        {canOpen && canCopy ? (
                          <DropdownMenuItem
                            onClick={() =>
                              window.open(
                                candidateInterviewUrl(
                                  r.accessToken,
                                  window.location.origin,
                                ),
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            Open
                          </DropdownMenuItem>
                        ) : null}
                        {r.status === "SCHEDULED" &&
                        r.displayStatus === "Active" ? (
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(`/dashboard/interviews/${r.id}/plan`)
                            }
                          >
                            Review plan
                          </DropdownMenuItem>
                        ) : null}
                        {canReport ? (
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(`/dashboard/interviews/${r.id}`)
                            }
                          >
                            View Report
                          </DropdownMenuItem>
                        ) : null}
                        {canCopy ? (
                          <DropdownMenuItem
                            onClick={() =>
                              setEmailFor({
                                candidateId: r.candidateId,
                                applicationId: r.applicationId,
                              })
                            }
                          >
                            Send Email
                          </DropdownMenuItem>
                        ) : null}
                        {canExpire ? (
                          <DropdownMenuItem onClick={() => expireLink(r.id)}>
                            Expire
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            No interview links match your filters.
          </p>
        ) : null}
      </div>

      {emailFor ? (
        <ComposeEmailDialog
          candidateId={emailFor.candidateId}
          applicationId={emailFor.applicationId}
          category="interview_invite"
          open
          onClose={() => setEmailFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Re-export helper for server page mapping */
export { interviewLinkDisplayStatus };
