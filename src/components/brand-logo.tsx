"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  BRAND_LOGO_DARK,
  BRAND_LOGO_LIGHT,
  PRODUCT_NAME,
} from "@/lib/branding";
import { cn } from "@/lib/utils";

type BrandLogoSize = "mark" | "nav" | "header" | "auth" | "hero";

/**
 * Official PNG. Never stretch. Never clip the wordmark horizontally.
 * nav/hero/auth trim empty vertical padding in the source file.
 */
export function BrandLogo({
  size = "mark",
  className,
}: {
  variant?: "mark" | "tagline";
  size?: BrandLogoSize;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isLight = mounted && resolvedTheme === "light";
  const src = isLight ? BRAND_LOGO_LIGHT : BRAND_LOGO_DARK;

  if (size === "mark") {
    return (
      <span className={cn("inline-flex h-8 max-w-full items-center bg-transparent", className)}>
        <img
          src={src}
          alt={PRODUCT_NAME}
          style={{ background: "transparent", objectFit: "contain", colorScheme: "normal" }}
          className="h-8 w-auto max-w-full object-contain"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex max-w-full items-center justify-center overflow-hidden bg-transparent",
        size === "hero" &&
          "h-[4.75rem] w-[min(100%,17.5rem)] sm:h-[5.5rem] sm:w-[min(100%,22.5rem)] md:h-24 md:w-[min(100%,27.5rem)]",
        size === "auth" && "h-[4.5rem] w-[min(100%,17.5rem)]",
        size === "header" && "h-16 w-full justify-start",
        size === "nav" && "h-11 w-full",
        className,
      )}
    >
      <img
        src={src}
        alt={PRODUCT_NAME}
        style={{ background: "transparent", objectFit: "contain", colorScheme: "normal" }}
        className="block h-auto w-full shrink-0 object-contain"
      />
    </span>
  );
}
