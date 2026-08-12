"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/** Staff helper: attach/re-parse is upload; screening stays for Phase 3. */
export function ApplicationResumeActions({ applicationId }: { applicationId: string }) {
  const router = useRouter();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        toast.message("Use Upload resume below — Phase 3 will add AI match breakdown.");
        router.refresh();
      }}
      data-application-id={applicationId}
    >
      Refresh
    </Button>
  );
}
