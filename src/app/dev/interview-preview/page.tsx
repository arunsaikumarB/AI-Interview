import { InterviewPreview } from "./preview-client";
import { interviewOrbVariant } from "@/lib/interview-orb-flag";

export const dynamic = "force-dynamic";

export default function InterviewPreviewPage() {
  return <InterviewPreview orbVariant={interviewOrbVariant()} />;
}
