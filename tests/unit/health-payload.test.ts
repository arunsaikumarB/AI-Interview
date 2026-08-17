/**
 * R-2 — health endpoint information disclosure.
 *
 * The audit found /api/health served, unauthenticated, the Ollama base URL,
 * chat and embedding model names, the speech-service URL, the storage root and
 * the mail mode. None of that is needed by a readiness probe.
 *
 * These tests pin both halves of the split:
 *   - the PUBLIC payload must stay boolean-only, and
 *   - the shape existing consumers depend on must not change:
 *       scripts/setup-pilot.sh          greps '"ok":true'
 *       scripts/verify-jobs-ui.mjs      greps '"database":{"ok":true}'
 *       database-offline-banner.tsx     reads data.database.ok
 *
 *   npx tsx --test tests/unit/health-payload.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detailedHealthPayload,
  publicHealthPayload,
  type HealthSnapshot,
} from "../../src/lib/health-payload";

const HEALTHY: HealthSnapshot = {
  database: { ok: true },
  provider: "local",
  ollama: {
    ok: true,
    provider: "local",
    baseUrl: "http://localhost:11434",
    chatModel: "qwen2.5:7b",
    embedModel: "nomic-embed-text",
    embedBaseUrl: "http://localhost:11434",
    models: ["qwen2.5:7b", "nomic-embed-text:latest"],
  },
  speech: { ok: true, whisperModel: "small", voice: "en_US-lessac-medium", device: "cpu" },
  speechUrl: "http://localhost:8001",
  storageRoot: "C:\\Users\\someone\\HireOS\\storage",
  mailMode: "clipboard",
};

const UNHEALTHY: HealthSnapshot = {
  ...HEALTHY,
  database: { ok: false, error: "Can't reach database server at localhost:55432" },
  ollama: { ...HEALTHY.ollama, ok: false, error: "connect ECONNREFUSED 127.0.0.1:11434" },
  speech: { ok: false, error: "fetch failed" },
};

/** Every string that must never appear in an unauthenticated response. */
const SECRETS = [
  "11434",
  "8001",
  "qwen2.5",
  "nomic-embed-text",
  "localhost",
  "127.0.0.1",
  "storage",
  "clipboard",
  "whisper",
  "lessac",
  "ECONNREFUSED",
  "55432",
];

function assertNoDisclosure(label: string, payload: unknown) {
  const raw = JSON.stringify(payload).toLowerCase();
  for (const secret of SECRETS) {
    assert.ok(
      !raw.includes(secret.toLowerCase()),
      `${label}: leaked "${secret}" in ${raw}`,
    );
  }
}

describe("R-2 public health payload — healthy", () => {
  const p = publicHealthPayload(HEALTHY);

  it("discloses nothing about the infrastructure", () => {
    assertNoDisclosure("healthy", p);
  });

  it("reports overall readiness", () => {
    assert.equal(p.ok, true);
  });

  it("keeps the exact serialized shape setup-pilot.sh greps for", () => {
    assert.ok(JSON.stringify(p).includes('"ok":true'));
  });

  it("keeps the exact serialized shape verify-jobs-ui.mjs greps for", () => {
    assert.ok(
      JSON.stringify(p).includes('"database":{"ok":true}'),
      `shape changed: ${JSON.stringify(p)}`,
    );
  });

  it("keeps database.ok for the dashboard offline banner", () => {
    assert.equal(p.database.ok, true);
  });

  it("reports dependency reachability as booleans only", () => {
    assert.deepEqual(p.ollama, { ok: true });
    assert.deepEqual(p.speech, { ok: true });
  });

  it("exposes no other keys", () => {
    assert.deepEqual(
      Object.keys(p).sort(),
      ["database", "ok", "ollama", "service", "speech"].sort(),
    );
  });
});

describe("R-2 public health payload — unhealthy", () => {
  const p = publicHealthPayload(UNHEALTHY);

  it("still discloses nothing, including error text", () => {
    assertNoDisclosure("unhealthy", p);
  });

  it("reports not-ok", () => {
    assert.equal(p.ok, false);
    assert.equal(p.database.ok, false);
    assert.equal(p.ollama.ok, false);
    assert.equal(p.speech.ok, false);
  });

  it("carries no error strings at all", () => {
    assert.ok(!("error" in p.database));
    assert.ok(!("error" in p.ollama));
    assert.ok(!("error" in p.speech));
  });
});

describe("R-2 readiness semantics are preserved", () => {
  it("ok tracks database and AI reachability, as before the split", () => {
    assert.equal(publicHealthPayload(HEALTHY).ok, true);
    assert.equal(publicHealthPayload({ ...HEALTHY, database: { ok: false } }).ok, false);
    assert.equal(
      publicHealthPayload({ ...HEALTHY, ollama: { ...HEALTHY.ollama, ok: false } }).ok,
      false,
    );
  });

  it("a speech outage does not make the app unready", () => {
    // Interviews degrade to text; the app is still serving.
    assert.equal(publicHealthPayload({ ...HEALTHY, speech: { ok: false } }).ok, true);
  });
});

describe("R-2 detailed payload is still available for operators", () => {
  const d = detailedHealthPayload(HEALTHY);

  it("retains the diagnostics the public view drops", () => {
    assert.equal(d.ollama.baseUrl, "http://localhost:11434");
    assert.equal(d.ollama.chatModel, "qwen2.5:7b");
    assert.equal(d.speech.url, "http://localhost:8001");
    assert.ok(d.storage);
    assert.ok(d.mail);
  });

  it("keeps the same readiness verdict as the public payload", () => {
    assert.equal(d.ok, publicHealthPayload(HEALTHY).ok);
  });

  it("surfaces dependency errors for operators", () => {
    const du = detailedHealthPayload(UNHEALTHY);
    assert.match(String(du.database.error), /database server/i);
  });
});
