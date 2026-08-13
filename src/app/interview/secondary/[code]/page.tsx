import type { Metadata } from "next";
import { SecondaryCameraClient } from "@/components/secondary-camera-client";

export const metadata: Metadata = {
  title: "Interview",
};

type Ctx = { params: { code: string } };

export default function SecondaryCameraPage({ params }: Ctx) {
  return (
    <div className="app-canvas min-h-screen px-4 py-8">
      <SecondaryCameraClient code={params.code} />
    </div>
  );
}
