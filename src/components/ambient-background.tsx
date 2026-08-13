"use client";

import { usePathname } from "next/navigation";

type AmbientVariant = "default" | "interview" | "camera";

function resolveVariant(pathname: string): AmbientVariant {
  if (pathname.startsWith("/interview/secondary")) return "camera";
  if (pathname.startsWith("/interview")) return "interview";
  return "default";
}

/**
 * Fixed atmospheric layer behind the app. Visual only.
 * Movement is CSS-transform based and disabled under reduced motion.
 */
export function AmbientBackground() {
  const pathname = usePathname() ?? "";
  const variant = resolveVariant(pathname);

  return (
    <div
      className="ambient-root"
      data-variant={variant}
      aria-hidden
    >
      <span className="ambient-blob ambient-blob-a" />
      <span className="ambient-blob ambient-blob-b" />
      <span className="ambient-blob ambient-blob-c" />
      <span className="ambient-blob ambient-blob-d" />
      <span className="ambient-blob ambient-blob-e" />
    </div>
  );
}
