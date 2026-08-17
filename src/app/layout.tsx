import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import {
  DOCUMENT_TITLE,
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
  SHORT_PRODUCT_NAME,
} from "@/lib/branding";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  applicationName: PRODUCT_NAME,
  title: {
    default: DOCUMENT_TITLE,
    template: `%s — ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  openGraph: {
    title: DOCUMENT_TITLE,
    description: PRODUCT_DESCRIPTION,
    siteName: PRODUCT_NAME,
  },
  twitter: {
    card: "summary",
    title: DOCUMENT_TITLE,
    description: PRODUCT_DESCRIPTION,
  },
  other: {
    "application-name": PRODUCT_NAME,
    "apple-mobile-web-app-title": SHORT_PRODUCT_NAME,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // R-1: middleware puts the per-request CSP nonce here so next-themes can
  // stamp its inline no-flash script. Next stamps its own scripts from the
  // CSP request header automatically.
  const nonce = headers().get("x-nonce") ?? undefined;

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${sans.variable} font-sans antialiased`}>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
