import assert from "node:assert/strict";
import os from "node:os";
import { afterEach, describe, it } from "node:test";
import { secondaryPairUrl } from "../../src/lib/public-app-url";

const ENV_KEYS = ["PUBLIC_HTTPS_URL", "NEXT_PUBLIC_APP_URL", "PUBLIC_HTTPS_PORT"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

function localIPv4(): string | null {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries ?? []) {
      if ((e.family === "IPv4" || String(e.family) === "4") && !e.internal) return e.address;
    }
  }
  return null;
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("secondary camera pairing URL", () => {
  it("uses the HTTPS address the candidate is on behind nginx, not the :3443 pilot port", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const r = req("http://127.0.0.1:5000/api/interview/t/proctoring/secondary", {
      host: "10.0.12.218",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "10.0.12.218",
    });
    const out = secondaryPairUrl("PAIR", r);
    assert.equal(out.pairUrl, "https://10.0.12.218/interview/secondary/PAIR");
    assert.equal(out.reachableFromPhone, true);
    assert.equal(out.requiresHttpsTrust, true);
  });

  it("keeps a non-default HTTPS port from the forwarded host", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const r = req("http://127.0.0.1:5000/x", {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "hireos.logisoft.local:8443",
    });
    assert.equal(secondaryPairUrl("P", r).pairUrl, "https://hireos.logisoft.local:8443/interview/secondary/P");
  });

  it("uses a configured HTTPS host name when the request is plain HTTP", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.NEXT_PUBLIC_APP_URL = "https://hireos.logisoft.local";
    const out = secondaryPairUrl("P", req("http://localhost:3000/x"));
    assert.equal(out.pairUrl, "https://hireos.logisoft.local/interview/secondary/P");
  });

  it("ignores a configured HTTPS IP that this machine does not have (stale Wi-Fi)", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.PUBLIC_HTTPS_URL = "https://203.0.113.77:3443";
    const out = secondaryPairUrl("P", req("http://localhost:3000/x"));
    assert.ok(!out.pairUrl.includes("203.0.113.77"), out.pairUrl);
  });

  it("ignores loopback and plain-HTTP origins and falls back to the LAN pilot", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.NEXT_PUBLIC_APP_URL = "https://localhost:3443";
    const out = secondaryPairUrl("P", req("https://localhost:3443/x", { host: "localhost:3443" }));
    const lan = localIPv4();
    if (lan) {
      assert.match(out.pairUrl, /^https:\/\/[\d.]+:3443\/interview\/secondary\/P$/);
    } else {
      assert.ok(out.pairUrl.endsWith("/interview/secondary/P"));
    }
  });
});
