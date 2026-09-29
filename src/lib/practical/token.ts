import crypto from "node:crypto";

/** 256-bit magic-link token; only its sha256 is stored. */
export function newAccessToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** base64url, 43 chars for 32 bytes. Anything else is rejected before touching the database. */
export const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

const PRACTICAL_LINK_LABEL = "hireos/practical-link/v1";

function practicalLinkKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return crypto.createHmac("sha256", secret).update(PRACTICAL_LINK_LABEL).digest();
}

/**
 * Practical magic-link token re-derivable by the server (so the candidate
 * assessment hub can launch it) while the database still holds only its
 * sha256. Same 43-char format as a random token. Rotating AUTH_SECRET
 * invalidates outstanding derived links.
 */
export function derivePracticalToken(assessmentId: string): string {
  return crypto.createHmac("sha256", practicalLinkKey()).update(assessmentId, "utf8").digest("base64url");
}

/** True when the stored hash belongs to the derived token (links assigned before V3.1 were random). */
export function isDerivedPracticalHash(assessmentId: string, accessTokenHash: string): boolean {
  const expected = Buffer.from(hashAccessToken(derivePracticalToken(assessmentId)), "hex");
  const actual = Buffer.from(accessTokenHash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
