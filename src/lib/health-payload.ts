/**
 * R-2 — health endpoint information disclosure.
 *
 * `/api/health` is deliberately public: the middleware allow-lists it, the
 * pilot bootstrap script polls it, the CI workflow waits on it and the
 * dashboard's offline banner reads it from the browser. That makes it the one
 * endpoint an unauthenticated caller can always reach, so it must not describe
 * the deployment.
 *
 * The split:
 *   publicHealthPayload    booleans only — reachability, nothing else.
 *   detailedHealthPayload  the previous full payload, for authenticated admins.
 *
 * The public shape is chosen to keep every existing consumer working:
 *   scripts/setup-pilot.sh       greps '"ok":true'
 *   scripts/verify-jobs-ui.mjs   greps '"database":{"ok":true}'
 *   database-offline-banner.tsx  reads data.database.ok
 */

export type DependencyState = { ok: boolean; error?: string; [key: string]: unknown };

export type HealthSnapshot = {
  database: { ok: boolean; error?: string };
  provider: string;
  ollama: DependencyState;
  speech: DependencyState;
  speechUrl: string;
  storageRoot: string;
  mailMode: string;
};

export type PublicHealth = {
  ok: boolean;
  service: string;
  database: { ok: boolean };
  ollama: { ok: boolean };
  speech: { ok: boolean };
};

const SERVICE = "Logisoft HireOS";

/**
 * Readiness verdict. Unchanged from the pre-split behaviour: the app is ready
 * when the database and the AI provider are reachable. A speech outage
 * degrades gracefully (text interviews continue) and is reported but does not
 * flip readiness.
 */
function isReady(snapshot: HealthSnapshot): boolean {
  return snapshot.database.ok === true && snapshot.ollama.ok === true;
}

export function publicHealthPayload(snapshot: HealthSnapshot): PublicHealth {
  // Every value below is a boolean or a fixed string. No URLs, no model names,
  // no filesystem paths, no error text, no hostnames.
  return {
    ok: isReady(snapshot),
    service: SERVICE,
    database: { ok: snapshot.database.ok === true },
    ollama: { ok: snapshot.ollama.ok === true },
    speech: { ok: snapshot.speech.ok === true },
  };
}

export function detailedHealthPayload(snapshot: HealthSnapshot) {
  return {
    ok: isReady(snapshot),
    service: SERVICE,
    selfHosted: snapshot.provider === "local",
    aiProvider: snapshot.provider,
    database: snapshot.database,
    ollama: snapshot.ollama,
    speech: { ...snapshot.speech, url: snapshot.speechUrl },
    storage: snapshot.storageRoot,
    mail: { mode: snapshot.mailMode, smtpConfigured: snapshot.mailMode === "smtp" },
  };
}

/** Only these roles may see the deployment's internals. */
export function canSeeHealthDetail(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "HR_ADMIN";
}
