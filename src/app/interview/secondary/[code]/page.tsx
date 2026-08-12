import { SecondaryCameraClient } from "@/components/secondary-camera-client";

type Ctx = { params: { code: string } };

export default function SecondaryCameraPage({ params }: Ctx) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <SecondaryCameraClient code={params.code} />
    </div>
  );
}
