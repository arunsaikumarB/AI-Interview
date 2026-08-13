import { Badge } from "@/components/ui/badge";
import { STAGE_LABELS } from "@/lib/constants";
import type { PipelineStage } from "@prisma/client";
import { recordingStatusLabel } from "@/lib/secondary-recording-labels";

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function InterviewReviewSummary({
  candidateName,
  role,
  interviewType,
  deliveryMode,
  durationMs,
  status,
  aiRecommendation,
  currentStage,
  proctoringMode,
  secondaryDeviceStatus,
  recordingStatus,
  hasRecording,
}: {
  candidateName: string;
  role: string;
  interviewType: string;
  deliveryMode: string;
  durationMs: number | null;
  status: string;
  aiRecommendation: string | null;
  currentStage: PipelineStage;
  proctoringMode: string;
  secondaryDeviceStatus: string;
  recordingStatus: string;
  hasRecording: boolean;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-medium text-foreground">Interview Summary</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Compact session overview — AI is advisory only.
        </p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Candidate" value={candidateName} />
        <Item label="Role" value={role} />
        <Item
          label="Interview type"
          value={`${interviewType} · ${deliveryMode === "VOICE" ? "Voice" : "Text"}`}
        />
        <Item label="Duration" value={formatDuration(durationMs)} />
        <Item label="Interview status" value={status} />
        <Item
          label="AI recommendation"
          value={aiRecommendation ?? "Not available yet"}
        />
        <Item
          label="Recruiter decision"
          value={STAGE_LABELS[currentStage] ?? currentStage}
        />
        <Item
          label="Proctoring mode"
          value={proctoringMode === "OFF" ? "Off" : proctoringMode}
        />
        <Item
          label="Secondary camera"
          value={
            hasRecording
              ? recordingStatusLabel(recordingStatus, true)
              : secondaryDeviceStatus === "NONE"
                ? "Not used"
                : recordingStatusLabel(recordingStatus, false)
          }
        />
      </dl>
      <Badge className="bg-warning/15 text-warning">
        AI recommendation — recruiter decides
      </Badge>
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
