/**
 * Local orb + camera layout preview (`/dev/interview-preview`).
 * It is not an interview flow and holds no candidate data, but a production
 * server must not serve it. Development keeps the route public so UI work
 * does not need a session.
 */

export function isDevInterviewPreviewPath(pathname: string): boolean {
  return (
    pathname === "/dev/interview-preview" ||
    pathname.startsWith("/dev/interview-preview/")
  );
}

/** Production returns 404 for this path. Every other NODE_ENV keeps it available. */
export function devInterviewPreviewBlocked(
  nodeEnv: string | undefined,
  pathname: string,
): boolean {
  return nodeEnv === "production" && isDevInterviewPreviewPath(pathname);
}
