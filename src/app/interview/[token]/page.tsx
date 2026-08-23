import type { Metadata } from "next";
import { InterviewRoom } from "@/components/interview-room";

export const metadata: Metadata = {
  title: "Interview",
};

type Ctx = { params: { token: string } };

export default function PublicInterviewPage({ params }: Ctx) {
  return (
    <div className="min-h-dvh bg-[#070b14]">
      <InterviewRoom token={params.token} />
    </div>
  );
}
