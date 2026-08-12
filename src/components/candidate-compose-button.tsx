"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ComposeEmailDialog } from "@/components/compose-email-dialog";

export function CandidateComposeButton({
  candidateId,
  applicationId,
}: {
  candidateId: string;
  applicationId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Send Email
      </Button>
      <ComposeEmailDialog
        open={open}
        onClose={() => setOpen(false)}
        candidateId={candidateId}
        applicationId={applicationId}
      />
    </>
  );
}
