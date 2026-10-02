import type { Metadata } from "next";
import { InterviewRoom } from "@/components/interview-room";
import { interviewOrbVariant } from "@/lib/interview-orb-flag";

export const metadata: Metadata = {
  title: "Interview",
};

export const dynamic = "force-dynamic";

type Ctx = { params: { token: string } };

export default function PublicInterviewPage({ params }: Ctx) {
  return (
    <div className="min-h-dvh bg-[#070b14]">
      <InterviewRoom token={params.token} orbVariant={interviewOrbVariant()} />
    </div>
  );
}
