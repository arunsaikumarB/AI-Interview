import type { Metadata } from "next";
import { PracticalRoom } from "@/components/practical/practical-room";

export const metadata: Metadata = {
  title: "Practical assessment",
};

type Ctx = { params: { token: string } };

export default function PracticalAssessmentPage({ params }: Ctx) {
  return (
    <div className="min-h-dvh bg-background">
      <PracticalRoom token={params.token} />
    </div>
  );
}
