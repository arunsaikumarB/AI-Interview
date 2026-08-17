/**
 * Phase 4A staff READ cutover. Default OFF — Next.js/Prisma remains live.
 * Rollback: set NEXT_PUBLIC_USE_DJANGO_READS=false and restart Next.js.
 */
export function parseUseDjangoReads(value: string | undefined): boolean {
  if (!value) return false;
  return ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

export function useDjangoReads(): boolean {
  return parseUseDjangoReads(process.env.NEXT_PUBLIC_USE_DJANGO_READS);
}

/** Server-side Django origin. Browser never calls this URL. */
export function djangoApiUrl(): string {
  const raw =
    process.env.DJANGO_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_DJANGO_API_URL?.trim() ||
    "http://127.0.0.1:8000";
  return raw.replace(/\/$/, "");
}
