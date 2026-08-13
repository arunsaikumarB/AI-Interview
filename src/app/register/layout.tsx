import type { Metadata } from "next";
import { PRODUCT_DESCRIPTION } from "@/lib/branding";

export const metadata: Metadata = {
  title: "Sign up",
  description: PRODUCT_DESCRIPTION,
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
