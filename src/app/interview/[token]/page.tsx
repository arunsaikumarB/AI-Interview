import type { Metadata } from "next";
import { InterviewRoom } from "@/components/interview-room";

export const metadata: Metadata = {
  title: "Interview",
};

type Ctx = { params: { token: string } };

export default function PublicInterviewPage({ params }: Ctx) {
  return (
    <div className="app-canvas min-h-dvh px-4 py-4 md:py-3">
      <InterviewRoom token={params.token} />
    </div>
  );
}
