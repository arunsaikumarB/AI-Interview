import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Second gate behind middleware. Production must not render the preview even
 * if a request reaches the segment. Development (NODE_ENV !== production)
 * keeps the page available.
 */
export default function DevInterviewPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return children;
}
