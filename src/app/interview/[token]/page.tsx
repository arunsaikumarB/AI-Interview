import { InterviewRoom } from "@/components/interview-room";

type Ctx = { params: { token: string } };

export default function PublicInterviewPage({ params }: Ctx) {
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8eef7_0%,_#f7f5f1_45%,_#f3efe8_100%)] px-4 py-8">
      <InterviewRoom token={params.token} />
    </div>
  );
}
