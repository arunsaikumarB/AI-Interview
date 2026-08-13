import type { Metadata } from "next";
import { PRODUCT_DESCRIPTION } from "@/lib/branding";

export const metadata: Metadata = {
  title: "Sign in",
  description: PRODUCT_DESCRIPTION,
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
