import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHttpResumeParserClient,
  dispositionFileName,
  getResumeParserClient,
  parseResumeParserBaseUrl,
  ResumeParserUnavailableError,
  searchQuery,
} from "../../src/lib/integrations/resume-parser/client";
import { resumeFileName } from "../../src/lib/integrations/resume-parser/add-profile";
import { clearProfileCache, recallProfile, rememberProfiles } from "../../src/lib/integrations/resume-parser/profile-cache";
import type { ResumeParserProfile } from "../../src/lib/integrations/resume-parser/types";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return respond(url);
  }) as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const apiProfile = (over: Record<string, unknown> = {}) => ({
  id: 1287,
  name: "Jane Doe",
  email: "jane.doe@example.com",
  phone_numbers: "+1 555 010 2000",
  location: "Dallas",
  region: "TX",
  linkedin: "https://linkedin.com/in/janedoe",
  total_experience: 8,
  skills: ["AWS", "Django", "Python"],
  matched_skills: ["Django", "Python"],
  created_at: "2026-09-14T10:22:31",
  file_name: "Jane_Doe_Resume.pdf",
  resume_url: "http://evil.example/steal/",
  ...over,
});

const page = (results: unknown[]) => ({ count: results.length, page: 1, page_size: 25, total_pages: 1, results });

const BASE = "http://10.0.12.50:8000";

describe("Resume Parser base URL and configuration", () => {
  it("accepts http(s) origins and trims trailing slashes", () => {
    assert.equal(parseResumeParserBaseUrl("http://10.0.12.50:8000/"), BASE);
    assert.equal(parseResumeParserBaseUrl("https://parser.local/prefix//"), "https://parser.local/prefix");
  });

  it("rejects other schemes, credentials, query strings and junk", () => {
    for (const bad of ["", "   ", "ftp://x", "file:///etc", "http://user:pw@x", "http://x/?a=1", "http://x/#f", "not a url"]) {
      assert.equal(parseResumeParserBaseUrl(bad), null, bad);
    }
  });

  it("is configured only with both URL and key", () => {
    assert.equal(getResumeParserClient({}).configured, false);
    assert.equal(getResumeParserClient({ RESUME_PARSER_API_URL: BASE }).configured, false);
    assert.equal(getResumeParserClient({ RESUME_PARSER_API_KEY: "k" }).configured, false);
    assert.equal(getResumeParserClient({ RESUME_PARSER_API_URL: "ftp://x", RESUME_PARSER_API_KEY: "k" }).configured, false);
    assert.equal(getResumeParserClient({ RESUME_PARSER_API_URL: BASE, RESUME_PARSER_API_KEY: "k" }).configured, true);
  });
});

describe("Resume Parser search", () => {
  it("builds the documented query", () => {
    const q = searchQuery(
      { skills: [" python ", "django", ""], anySkills: ["flask"], excludeSkills: ["php"], minExperience: 3, maxExperience: 10, city: " dallas ", state: "TX" },
      2,
      50,
    );
    assert.equal(
      q.toString(),
      "skills=python%2Cdjango&any_skills=flask&exclude_skills=php&min_experience=3&max_experience=10&city=dallas&state=TX&page=2&page_size=50",
    );
    assert.equal(searchQuery({ anySkills: ["go"] }, 1, 25).toString(), "any_skills=go&page=1&page_size=25");
  });

  it("sends the key, refuses redirects and returns validated profiles", async () => {
    const f = fakeFetch(() => json(page([apiProfile(), apiProfile({ id: 2, name: null, email: null, total_experience: null, file_name: null })])));
    const client = createHttpResumeParserClient({ baseUrl: BASE, apiKey: "secret-key", fetchImpl: f.impl });
    const res = await client.search({ skills: ["python"] }, 1, 25);

    assert.equal(f.calls.length, 1);
    assert.ok(f.calls[0].url.startsWith(`${BASE}/api/v1/external/profiles/search/?skills=python`));
    assert.equal((f.calls[0].init.headers as Record<string, string>)["X-API-Key"], "secret-key");
    assert.equal(f.calls[0].init.redirect, "error");
    assert.ok(f.calls[0].init.signal);

    assert.equal(res.total, 2);
    assert.equal(res.profiles[0].name, "Jane Doe");
    assert.equal("resume_url" in res.profiles[0], false);
    assert.deepEqual(
      { name: res.profiles[1].name, email: res.profiles[1].email, exp: res.profiles[1].total_experience, file: res.profiles[1].file_name },
      { name: "", email: "", exp: null, file: "" },
    );
  });

  it("maps failures to safe reasons", async () => {
    const cases: [Response | Error, string][] = [
      [new Response("no", { status: 403 }), "rejected_key"],
      [new Response("no", { status: 401 }), "rejected_key"],
      [new Response("{}", { status: 400 }), "bad_request"],
      [new Response("boom", { status: 500 }), "unreachable"],
      [new Response("<html>", { status: 200 }), "bad_response"],
      [json({ count: "x" }), "bad_response"],
      [json(page([apiProfile({ id: -1 })])), "bad_response"],
      [new Error("ECONNREFUSED"), "unreachable"],
    ];
    for (const [outcome, reason] of cases) {
      const f = fakeFetch(() => {
        if (outcome instanceof Error) throw outcome;
        return outcome;
      });
      const client = createHttpResumeParserClient({ baseUrl: BASE, apiKey: "super-secret-key", fetchImpl: f.impl });
      await assert.rejects(client.search({ skills: ["x"] }, 1, 25), (err: unknown) => {
        assert.ok(err instanceof ResumeParserUnavailableError);
        assert.equal(err.reason, reason);
        assert.equal(err.message.includes("super-secret-key"), false);
        return true;
      });
    }
  });

  it("refuses oversized search responses", async () => {
    const big = "x".repeat(2 * 1024 * 1024 + 10);
    const f = fakeFetch(() => new Response(big, { status: 200 }));
    const client = createHttpResumeParserClient({ baseUrl: BASE, apiKey: "k", fetchImpl: f.impl });
    await assert.rejects(client.search({ skills: ["x"] }, 1, 25), (err: unknown) => (err as ResumeParserUnavailableError).reason === "too_large");
  });
});

describe("Resume Parser resume download", () => {
  const pdf = Buffer.from("%PDF-1.4 test");

  it("downloads from the configured server by id, never from resume_url", async () => {
    const f = fakeFetch(
      () =>
        new Response(pdf, {
          status: 200,
          headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="Jane_Doe_Resume.pdf"' },
        }),
    );
    const client = createHttpResumeParserClient({ baseUrl: BASE, apiKey: "k", fetchImpl: f.impl });
    const file = await client.getResumeFile(1287);
    assert.equal(f.calls[0].url, `${BASE}/api/v1/external/profiles/1287/resume/`);
    assert.equal(f.calls[0].init.redirect, "error");
    assert.equal(file?.fileName, "Jane_Doe_Resume.pdf");
    assert.equal(file?.mimeType, "application/pdf");
    assert.equal(file?.data.toString(), pdf.toString());
  });

  it("returns null for 404 and for ids that are not positive integers (without calling)", async () => {
    const f = fakeFetch(() => new Response("missing", { status: 404 }));
    const client = createHttpResumeParserClient({ baseUrl: BASE, apiKey: "k", fetchImpl: f.impl });
    assert.equal(await client.getResumeFile(5), null);
    for (const bad of [0, -1, 1.5, Number.NaN]) assert.equal(await client.getResumeFile(bad), null);
    assert.equal(f.calls.length, 1);
  });

  it("refuses files over 10 MB, by header and by actual size", async () => {
    const declared = fakeFetch(() => new Response(pdf, { status: 200, headers: { "Content-Length": String(11 * 1024 * 1024) } }));
    const c1 = createHttpResumeParserClient({ baseUrl: BASE, apiKey: "k", fetchImpl: declared.impl });
    await assert.rejects(c1.getResumeFile(1), (err: unknown) => (err as ResumeParserUnavailableError).reason === "too_large");

    const actual = fakeFetch(() => new Response(Buffer.alloc(10 * 1024 * 1024 + 1), { status: 200 }));
    const c2 = createHttpResumeParserClient({ baseUrl: BASE, apiKey: "k", fetchImpl: actual.impl });
    await assert.rejects(c2.getResumeFile(1), (err: unknown) => (err as ResumeParserUnavailableError).reason === "too_large");
  });

  it("reduces Content-Disposition names to a plain base name", () => {
    assert.equal(dispositionFileName('attachment; filename="../../etc/passwd"'), "passwd");
    assert.equal(dispositionFileName("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"), "résumé.pdf");
    assert.equal(dispositionFileName('attachment; filename="C:\\\\x\\\\cv.docx"'), "cv.docx");
    assert.equal(dispositionFileName('attachment; filename=".."'), null);
    assert.equal(dispositionFileName(null), null);
  });

  it("stores under a safe name whose extension matches the type", () => {
    assert.equal(resumeFileName(7, "Jane_Doe_Resume.pdf", "application/pdf"), "Jane_Doe_Resume.pdf");
    assert.equal(resumeFileName(7, "../../etc/passwd", "application/pdf"), "_.._etc_passwd.pdf");
    assert.equal(resumeFileName(7, null, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "resume-7.docx");
    assert.equal(resumeFileName(7, "cv.DOC", "application/msword"), "cv.doc");
    assert.equal(resumeFileName(7, "weird<>name.exe", "application/pdf"), "weird__name.exe.pdf");
  });
});

describe("profiles remembered from searches", () => {
  const profile = (id: number) => ({ id, name: `P${id}` }) as unknown as ResumeParserProfile;

  it("are scoped to the organization and expire", () => {
    clearProfileCache();
    rememberProfiles("orgA", [profile(1)], 1_000);
    assert.equal(recallProfile("orgA", 1, 2_000)?.name, "P1");
    assert.equal(recallProfile("orgB", 1, 2_000), null);
    assert.equal(recallProfile("orgA", 2, 2_000), null);
    assert.equal(recallProfile("orgA", 1, 1_000 + 60 * 60 * 1000 + 1), null);
    clearProfileCache();
  });
});
