import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { Providers } from "@/components/providers";
import {
  DEFAULT_COMPANY_NAME,
  DOCUMENT_TITLE,
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
  SHORT_PRODUCT_NAME,
} from "@/lib/branding";
import "./globals.css";

const sans = Manrope({
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
    siteName: DEFAULT_COMPANY_NAME,
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
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${sans.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
