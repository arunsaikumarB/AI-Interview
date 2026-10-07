import type { ResumeParserProfile } from "./types";

/**
 * Profiles this server received from Resume Parser searches, per organization. The API has no
 * "get one profile" endpoint, so Add to Talent Pool reads the profile from here instead of
 * trusting details sent by the browser. In memory only: a restart means searching again.
 */
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

const cache = new Map<string, { profile: ResumeParserProfile; at: number }>();

const keyOf = (organizationId: string, profileId: number) => `${organizationId}:${profileId}`;

export function rememberProfiles(organizationId: string, profiles: ResumeParserProfile[], now = Date.now()): void {
  for (const profile of profiles) {
    const key = keyOf(organizationId, profile.id);
    cache.delete(key);
    cache.set(key, { profile, at: now });
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function recallProfile(organizationId: string, profileId: number, now = Date.now()): ResumeParserProfile | null {
  const key = keyOf(organizationId, profileId);
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.profile;
}

export function clearProfileCache(): void {
  cache.clear();
}
