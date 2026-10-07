import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities,
  laterSiteTime,
  oneLine,
  parseExperienceYears,
  parseSkills,
  plainText,
  shiftSiteTime,
  splitName,
} from "../../src/lib/integrations/careers/text";
import {
  CareersUnavailableError,
  createHttpCareersClient,
  parseCareersConfig,
} from "../../src/lib/integrations/careers/client";
import { intervalMinutes } from "../../src/lib/integrations/careers/runner";
import { applicationDetailsText } from "../../src/lib/integrations/careers/sync";

const BASE = "https://careers.example.test";
const KEY = "unit-test-key-123";

function app(over: Record<string, unknown> = {}) {
  return {
    application_id: 1201,
    applied_on: "2026-10-07 08:08:01",
    applicant_name: "Asha  Rao",
    applicant_email: "Asha@Example.com",
    applicant_phone: "+91 98765 43210",
    job_id: 5631,
    job_title: "AI Engineer &#8211; Hyderabad",
    cover_letter: "<p>Hello&nbsp;team</p>",
    total_experience: "5.3 years",
    skills_exposure: "Python, SQL",
    resume_url: "https://evil.example/steal",
    ftp_file_path: "/etc/passwd",
    ...over,
  };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(handler: (url: string) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url);
  }) as typeof fetch;
  return { calls, impl };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("careers text helpers", () => {
  it("decodes WordPress entities", () => {
    assert.equal(decodeEntities("AI Engineer &#8211; Hyd &amp; Remote"), "AI Engineer – Hyd & Remote");
    assert.equal(decodeEntities("&lt;1"), "<1");
    assert.equal(decodeEntities("&#x27;x&#39;"), "'x'");
    assert.equal(decodeEntities("&#0; &#xD800; &unknown;"), "&#0; &#xD800; &unknown;");
  });

  it("keeps plain text only", () => {
    assert.equal(plainText("<p>Hi<br>there</p><script>x</script>", 100), "Hi\nthere\nx");
    assert.equal(oneLine("  a \n b  ", 10), "a b");
    assert.equal(plainText("x".repeat(50), 10).length, 10);
  });

  it("reads experience from free text", () => {
    assert.equal(parseExperienceYears("5.3 years"), 5.3);
    assert.equal(parseExperienceYears("5"), 5);
    assert.equal(parseExperienceYears("3+"), 3);
    assert.equal(parseExperienceYears("&lt;1"), 0);
    assert.equal(parseExperienceYears("2 years 6 months"), 2.5);
    assert.equal(parseExperienceYears("8 months"), 0.7);
    assert.equal(parseExperienceYears("Fresher"), 0);
    assert.equal(parseExperienceYears("NA"), null);
    assert.equal(parseExperienceYears(""), null);
    assert.equal(parseExperienceYears("99 years"), null);
  });

  it("splits skills and names", () => {
    assert.deepEqual(parseSkills("Python, SQL; Power BI\n- Excel"), ["Python", "SQL", "Power BI", "Excel"]);
    assert.deepEqual(splitName("  Asha   Rao K ", "a@x.com"), { firstName: "Asha", lastName: "Rao K" });
    assert.deepEqual(splitName("", "kiran.d@x.com"), { firstName: "kiran.d", lastName: "" });
  });

  it("shifts and compares site times without timezone changes", () => {
    assert.equal(shiftSiteTime("2026-10-07 00:05:00", -10), "2026-10-06 23:55:00");
    assert.equal(shiftSiteTime("bad", -10), null);
    assert.equal(laterSiteTime("2026-10-07 08:00:00", "2026-10-06 09:00:00"), "2026-10-07 08:00:00");
    assert.equal(laterSiteTime(null, "2026-10-06 09:00:00"), "2026-10-06 09:00:00");
  });

  it("writes the form answers as plain text", () => {
    const text = applicationDetailsText({
      ...app(),
      relevant_experience: "",
      education: "",
      hometown: "",
      current_town: "Pune",
      current_ctc: "6 LPA",
      expected_ctc: "",
      notice_period: "30 days",
      tentative_joining: "",
      interview_availability: "",
      reason_leaving: "",
      linkedin_url: "",
      resume_filename: "",
    } as never);
    assert.match(text, /^Applied on the LogiSoft careers page on 2026-10-07 08:08:01 \(application 1201\)\./);
    assert.match(text, /Current town: Pune/);
    assert.match(text, /Notice period: 30 days/);
    assert.match(text, /Cover letter:\nHello team/);
    assert.doesNotMatch(text, /Expected CTC/);
    assert.doesNotMatch(text, /<p>/);
  });
});

describe("careers config", () => {
  it("needs both a plain http(s) URL and a key", () => {
    assert.equal(parseCareersConfig({}), null);
    assert.equal(parseCareersConfig({ CAREERS_API_URL: BASE }), null);
    assert.equal(parseCareersConfig({ CAREERS_API_URL: "ftp://x", CAREERS_API_KEY: KEY }), null);
    assert.equal(parseCareersConfig({ CAREERS_API_URL: "https://u:p@x.test", CAREERS_API_KEY: KEY }), null);
    assert.equal(parseCareersConfig({ CAREERS_API_URL: BASE, CAREERS_API_KEY: "a b" }), null);
    assert.deepEqual(parseCareersConfig({ CAREERS_API_URL: `${BASE}/`, CAREERS_API_KEY: ` ${KEY} ` }), {
      baseUrl: BASE,
      apiKey: KEY,
    });
  });

  it("runs every 15 minutes in production and is off in development unless set", () => {
    assert.equal(intervalMinutes({ NODE_ENV: "production" }), 15);
    assert.equal(intervalMinutes({ NODE_ENV: "development" }), 0);
    assert.equal(intervalMinutes({ NODE_ENV: "development", CAREERS_SYNC_INTERVAL_MINUTES: "15" }), 15);
    assert.equal(intervalMinutes({ NODE_ENV: "production", CAREERS_SYNC_INTERVAL_MINUTES: "0" }), 0);
    assert.equal(intervalMinutes({ NODE_ENV: "production", CAREERS_SYNC_INTERVAL_MINUTES: "1" }), 5);
    assert.equal(intervalMinutes({ NODE_ENV: "production", CAREERS_SYNC_INTERVAL_MINUTES: "junk" }), 15);
  });
});

describe("careers client", () => {
  it("lists one page with the Bearer key, no redirects, and skips malformed rows", async () => {
    const f = fakeFetch(() =>
      json({
        success: true,
        page: 1,
        per_page: 100,
        count: 3,
        total: 3,
        total_pages: 1,
        applications: [app(), app({ application_id: "1202", job_id: "5631" }), { application_id: "x" }],
      }),
    );
    const client = createHttpCareersClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl });
    const page = await client.listApplications({ page: 2, after: "2026-10-07 08:00:00" });
    assert.equal(page.applications.length, 2);
    assert.equal(page.malformed, 1);
    assert.equal(page.applications[1].application_id, 1202);
    assert.equal(page.applications[0].job_title, "AI Engineer &#8211; Hyderabad");
    const url = new URL(f.calls[0].url);
    assert.equal(url.origin + url.pathname, `${BASE}/wp-json/careers/v1/live-applications`);
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("per_page"), "100");
    assert.equal(url.searchParams.get("after"), "2026-10-07 08:00:00");
    assert.equal((f.calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
    assert.equal(f.calls[0].init.redirect, "error");
  });

  it("downloads resumes from the configured site only, by numeric id", async () => {
    const f = fakeFetch((url) =>
      url.endsWith("/1201/resume")
        ? new Response(Buffer.from("%PDF-1.4 test"), {
            headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="../cv.pdf"' },
          })
        : new Response("", { status: 404 }),
    );
    const client = createHttpCareersClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: f.impl });
    const file = await client.getResume(1201);
    assert.equal(f.calls[0].url, `${BASE}/wp-json/careers/v1/live-applications/1201/resume`);
    assert.equal(file?.fileName, "cv.pdf");
    assert.equal(file?.mimeType, "application/pdf");
    assert.equal(await client.getResume(999), null);
    assert.equal(await client.getResume(-1), null);
    assert.equal(await client.getResume(1.5), null);
    assert.equal(f.calls.length, 2);
  });

  it("reports a rejected key, an unreachable site and a bad response as errors", async () => {
    const reasons: string[] = [];
    for (const res of [
      () => new Response("", { status: 401 }),
      () => new Response("", { status: 500 }),
      () => json({ success: false }),
      () => new Response("not json"),
    ]) {
      const client = createHttpCareersClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: fakeFetch(res).impl });
      await client.listApplications({ page: 1 }).catch((err: unknown) => {
        assert.ok(err instanceof CareersUnavailableError);
        reasons.push(err.reason);
        assert.doesNotMatch(err.message, new RegExp(KEY));
      });
    }
    assert.deepEqual(reasons, ["rejected_key", "unreachable", "bad_response", "bad_response"]);
  });
});
