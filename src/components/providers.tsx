"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { AmbientBackground } from "@/components/ambient-background";
import { Toaster } from "@/components/ui/sonner";

export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  /**
   * R-1: next-themes injects its own inline no-flash script, which Next does
   * not stamp. Without the nonce it is the one script the production CSP
   * blocks, and the page loads with the wrong theme until hydration.
   */
  nonce?: string;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      themes={["dark", "light"]}
      storageKey="aros-theme-v2"
      nonce={nonce}
    >
      <QueryClientProvider client={queryClient}>
        <AmbientBackground />
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
