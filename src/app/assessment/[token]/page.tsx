import type { Metadata } from "next";
import { AssessmentHub } from "@/components/candidate-assessment/assessment-hub";

export const metadata: Metadata = {
  title: "Your assessment",
};

type Ctx = { params: { token: string } };

export default function CandidateAssessmentPage({ params }: Ctx) {
  return (
    <div className="min-h-dvh bg-background">
      <AssessmentHub token={params.token} />
    </div>
  );
}
