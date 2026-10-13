"use client";

import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";

export default function SecondaryCameraError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="app-canvas min-h-screen px-4 py-8">
      <div
        role="alert"
        className="mx-auto max-w-md space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive"
      >
        <div className="text-foreground">
          <BrandLogo size="header" />
        </div>
        <p className="font-medium">The secondary camera page couldn&apos;t start.</p>
        <p className="text-sm">
          Try again. If it keeps happening, reload the page, or open the link in Safari (iPhone) or
          Chrome (Android) and scan the latest QR code on the interview laptop.
        </p>
        <div className="flex gap-2 pt-1">
          <Button className="flex-1" onClick={reset}>
            Try again
          </Button>
          <Button className="flex-1" variant="outline" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </div>
    </div>
  );
}
