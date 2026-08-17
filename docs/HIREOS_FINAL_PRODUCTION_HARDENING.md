# HireOS — Final Production Hardening (R-1, R-2, R-3, R-10)

**Date:** 17 August 2026
**Scope:** Only the four approved hardening findings from the final Integration/UAT audit.
**Not in scope, not touched:** #15 `SECONDARY_DEVICE_INTERACTION` (deferred), Phase 4C.4, Prisma schema, AI scoring, interview logic, application stages, recording/chunking, proctoring detection.

---

## 1. Executive summary

All four approved items are implemented, test-first, and **all four are now fully verified against the complete running stack**. No application code was changed during the verification pass.

| Item | Verdict |
|---|---|
| **R-1** Security headers | **PASS** — live headers, browser, and MediaPipe WASM under the CSP |
| **R-2** Health endpoint disclosure | **PASS** — Next.js live, Django 8/8 tests |
| **R-3** AI evaluation failure & retry | **PASS** — 25 unit + 23 database-backed + 19 live outage assertions |
| **R-10** Secure cookie | **PASS** — full matrix verified in both modes, including real TLS on :3443 |
| **#15** Device interaction | **DEFERRED — NOT CLOSED**, untouched |

**461 automated tests pass, 0 fail** (194 unit, 99 isolation, 168 Django), plus 19 live end-to-end R-3 outage assertions. Production build exits 0, lint 0 errors, TypeScript clean, Prisma schema unchanged and drift-free.

The decisive evidence for the two items that were previously unverified:

- **R-3**: a real interview was concluded with the AI unreachable. The candidate could still finish; the background evaluation retried exactly **3 times**, gave up, and wrote a durable failure record containing `kind, error, status, attempts, sessionId, advisoryOnly` — **no score, no recommendation, no reasoning, and no `AIEvaluation` row**. The API reported `state: "failed"` with `overall: null`, and `Application.stage` never moved. After recovery, the operator retry produced a real evaluation in 141 s and the state flipped to `completed` while the failure audit row was retained.
- **R-10**: over real TLS on `https://localhost:3443` the same development build issued `Secure; HttpOnly; SameSite=lax` — the exact gap R-10 closed — while plain HTTP on `http://localhost:3000` issued the cookie without `Secure`, so development login still works.

**Recommendation: GO — PRODUCTION READY.** See section 19.

### Verification pass — history

The first attempt at this hardening pass was cut short: Docker Desktop crashed midway, its privileged helper `com.docker.service` stopped, and PostgreSQL/Redis/Ollama/speech went with it. That left 199 tests unrun and R-3/R-10 unverified, and the report was issued as CONDITIONAL GO. Docker was subsequently restored by the operator and this section records the completed verification. Two failures surfaced during the completion pass; **both were environmental and neither was a regression** — see section 20.

---

## 2. Starting state

- Branch `main`, 46 modified tracked files and 60 untracked files from previously approved work — all left untouched except the files listed in section 16.
- Baseline before this pass: **316 tests passing** (117 unit, 39 isolation, 160 Django).
- Production build succeeded; lint clean; Prisma schema unchanged.

All prior remediations (F-01…F-05, R1/R2/R5, R6, R7, R8) were present and were not modified.

---

## 3. R-1 — Security headers

### Findings

No security headers existed anywhere. `src/middleware.ts` set none, and `next.config.mjs` had no `headers()` block. Confirmed live before the change: `content-security-policy`, `x-frame-options` and `strict-transport-security` were all absent.

Architecture inspection determined what a policy must accommodate:

| Requirement | Evidence | Allowance |
|---|---|---|
| MediaPipe WebAssembly | `FilesetResolver.forVisionTasks("/mediapipe/wasm")` in `proctoring.ts` and `secondary-integrity-client.ts`; six vendored `.wasm`/`.js` files | `'wasm-unsafe-eval'` |
| Pairing QR | `QRCode.toDataURL()` in `enhanced-proctoring-setup.tsx` | `img-src data:` |
| Recording / TTS playback | `URL.createObjectURL` in four components | `media-src blob:` |
| Camera + microphone | interview room, secondary camera | `Permissions-Policy: camera=(self), microphone=(self)` |
| Fonts | `next/font/google` self-hosts Inter at build time | `font-src 'self' data:` — **no external origin needed** |
| Third-party origins | grep found exactly one external URL in `src/`, `https://ollama.com`, used server-side only | none required |
| Dev HMR | React Refresh + websocket | dev-only `'unsafe-eval'`, `ws:`/`wss:` |

Because the app is entirely self-hosted, a genuinely strict `'self'`-based policy is realistic rather than aspirational.

### Fix

New `src/lib/security-headers.ts` builds the header set as pure, testable functions. `src/middleware.ts` applies them to **every** exit path (page, API, 401, 403, redirect). `next.config.mjs` covers the asset paths the middleware matcher skips (anything containing a dot: `/_next/static/**`, `/mediapipe/**`) with `nosniff` + `Referrer-Policy`, deliberately *not* CSP so the header is never sent twice.

Production CSP:

```
default-src 'self'; script-src 'self' 'nonce-<per-request>' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:;
font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self';
object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self';
form-action 'self'; upgrade-insecure-requests
```

Plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that keeps camera/microphone on `self` and denies geolocation/payment/USB, and `Strict-Transport-Security: max-age=15552000; includeSubDomains`. `poweredByHeader: false` was added.

Two directives are conditional on the request actually being HTTPS (via `x-forwarded-proto`, which `scripts/lan-https-proxy.mjs` sets): **HSTS** and **`upgrade-insecure-requests`**. Emitting either on a plain-HTTP LAN pilot would be meaningless at best and would rewrite every subresource to `https://` at worst.

### The problem the browser caught

The first implementation looked correct and would have **broken the login page**. `/login` and `/register` were statically pre-rendered (`○` in the build output), so their HTML was baked at build time with **6 inline scripts carrying no nonce**. Under a nonce-based CSP, CSP3 browsers ignore `'unsafe-inline'` entirely, so all six — the theme initialiser and the whole RSC hydration payload — would have been blocked.

This was caught by fetching the rendered HTML, not by reasoning about it. A dynamically rendered page (`/careers`) showed 6 nonced and 0 un-nonced scripts, which proved the nonce mechanism itself worked and isolated the fault to static pre-rendering.

`export const dynamic = "force-dynamic"` is ignored inside a `"use client"` module, so the two pages were split into a thin server wrapper (`page.tsx`) plus the unchanged client screen (`login-screen.tsx`, `register-screen.tsx`). This is the standard Next idiom for nonce-based CSP and changes no product behaviour.

That left exactly one un-nonced script: `next-themes` injects its own inline no-flash script, which Next does not stamp. `next-themes@0.4.6` accepts a `nonce` prop, so the root layout now reads `x-nonce` (set by middleware) and passes it through `Providers`.

### Verification — evidence

Against the production build (`npm run build && next start`):

```
content-security-policy: default-src 'self'; script-src 'self' 'nonce-L4Z758fvMwvy4ViHKccn4w==' 'wasm-unsafe-eval'; …
permissions-policy: camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), interest-cohort=()
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
x-powered-by: (absent)
```

| Check | Result |
|---|---|
| `/login` un-nonced inline scripts | **0** (was 6) |
| `/login` nonced inline scripts | **6** |
| `/register` un-nonced / nonced | **0 / 6** |
| Nonce differs between two requests | yes |
| HSTS over plain HTTP | absent (correct) |
| HSTS with `x-forwarded-proto: https` | `max-age=15552000; includeSubDomains` |
| Headers on a 401 from `/api/jobs` | present |

In a real browser loading the hardened production build at `/login`:

- The page hydrated fully — all five interactive controls present.
- **Zero console messages, zero errors** — no CSP violations of any kind.
- Theme applied (`<html class="dark">`), proving the nonced `next-themes` script executed.

Executed inside that CSP-governed page:

| Capability | Result |
|---|---|
| `fetch('/mediapipe/wasm/vision_wasm_internal.wasm')` | **200, 11 756 954 bytes** |
| `WebAssembly.compile(...)` | **OK — 154 exports** |
| `import('/mediapipe/wasm/vision_wasm_internal.js')` | **OK** |
| `data:` image load (QR path) | **OK** |
| `URL.createObjectURL` (recording path) | **OK** |

That is direct evidence the proctoring/camera stack is not broken by the policy.

**R-1: PASS.**

---

## 4. R-2 — Health endpoint information disclosure

### Findings

`/api/health` returned, with no authentication: the Ollama base URL and embedding URL, the chat and embedding model names, the installed model list, the speech-service URL, the Whisper model, the Piper voice, the compute device, the storage root and the mail mode. On failure it also returned raw error text.

`backend/common/views.py::HealthView` was `AllowAny` with `authentication_classes = []` and echoed raw psycopg/redis exception strings — which include host and port — plus Celery worker hostnames.

Consumers that had to keep working were identified before changing anything:

| Consumer | Depends on |
|---|---|
| `scripts/setup-pilot.sh` | greps `"ok":true` |
| `scripts/verify-jobs-ui.mjs` | greps `"ok":true` **and** `"database":{"ok":true}` |
| `src/components/database-offline-banner.tsx` | reads `data.database.ok` |
| `.github/workflows/isolation.yml` | `curl -sf` (HTTP status only) |
| 3 isolation test files | `health.ok` (HTTP status only) |
| `docker-compose.yml` | no healthcheck on the app container |

### Fix

New `src/lib/health-payload.ts` splits the payload. The public response is boolean-only:

```json
{"ok":true,"service":"Logisoft HireOS","database":{"ok":true},"ollama":{"ok":true},"speech":{"ok":true}}
```

An authenticated `SUPER_ADMIN` or `HR_ADMIN` gets the previous full payload from the same URL — deliberately the same endpoint, so there is no second diagnostic route that could be left exposed. The session lookup is wrapped in try/catch because a database outage is exactly when it cannot resolve a role.

Readiness semantics are unchanged: `ok` still tracks database + AI reachability, and a speech outage still does not flip readiness (text interviews degrade gracefully).

Django now reduces each probe to `{"ok": bool}` via a `_public()` helper and adds a top-level `ok`. No HTTP escape hatch was added — `manage.py hireos_probes` remains the operator path, so no query parameter can widen the response. The 200/503 status semantics are unchanged.

### Verification — evidence

Live against the production build:

```
{"ok":false,"service":"Logisoft HireOS","database":{"ok":false},"ollama":{"ok":false},"speech":{"ok":false}}
```

(all dependencies were down at the time — which made this a stronger test, since the *unhealthy* path is where error strings used to leak)

| Check | Result |
|---|---|
| Only 5 keys: `ok, service, database, ollama, speech` | PASS |
| No `11434`, `8001`, `qwen`, `nomic`, `localhost`, `127.0.0.1`, `storage`, `whisper`, `lessac`, `clipboard` | PASS (10/10) |
| No `error` key on any dependency, even when down | PASS |
| `"database":{"ok":` shape preserved for `verify-jobs-ui.mjs` | PASS |
| `ok` boolean preserved for `setup-pilot.sh` | PASS |

**R-2 (Next.js): PASS.**
**R-2 (Django): PASS** — all 8 tests in `backend/common/tests/test_health_disclosure.py` pass. Live confirmation with the full stack up:

```
{"ok":true,"django":{"ok":true},"postgres":{"ok":true},"redis":{"ok":true},"celery":{"ok":true}}
```

Every dependency reduced to a bare `{"ok": …}` — no `error`, no `workers`, no host, no port. Tests additionally cover: postgres failure hiding the connection string, redis failure hiding the broker URL, Celery worker hostnames not being public, 503 on an unready app, reachability without credentials, and four query-parameter escape attempts (`?detail=1`, `?detail=true`, `?verbose=1`, `?full=1`) all failing to widen the response.

---

## 5. R-3 — AI evaluation failure / retry handling

### Findings — the exact place failures disappeared

Traced the full path: `answer` route → `processAnswerTurn` → `void scoreInBackground(...)` (fire-and-forget, two call sites) → `evaluateAnswerOnly` / `finalEvaluation` → Ollama → `AIEvaluation` row → `GET /api/interviews/[id]` → `interview-report.tsx`.

Three defects:

1. **`process-answer-turn.ts:260` and `:310`** caught every error and only `console.warn`/`console.error`'d it. Nothing was persisted, so the failure existed only in the server's stdout.
2. **`GET /api/interviews/[id]`** returned `overall: null` for both "still generating" and "failed" — the two states were indistinguishable by construction.
3. **`interview-report.tsx`** computed `showMissingBanner = !result && interviewStatus === "COMPLETED"`, so it claimed the evaluation was "missing" the instant the interview ended — a false alarm during the ~2 minutes generation legitimately takes on CPU-bound Ollama, and no distinct signal once it had genuinely failed.

There was a single retry attempt and no backoff.

**Screening was checked and is not affected**: `/api/applications/[id]/screen` runs synchronously and propagates through `handleApiError`, which the UAT already confirmed returns a clean `503 OLLAMA_UNREACHABLE`.

### Fix — no schema change, no new queue

New `src/lib/ai/evaluation-status.ts`:

- `MAX_EVALUATION_ATTEMPTS = 3` (initial + 2 retries) with linear backoff — **bounded by construction**.
- `isRetryableEvaluationError` retries transient failures (`UNREACHABLE`, `TIMEOUT`, `HTTP`) and refuses to retry `VALIDATION`/malformed-JSON errors, which would fail identically.
- `evaluationFailurePayload` / `evaluationSuccessPayload` build a typed `AI_EVALUATION` `TimelineEvent` payload — the same row type a successful evaluation already wrote. **No Prisma schema change was needed.**
- `deriveEvaluationState` is the single source of truth used by both the API and the UI.

`scoreInBackground` was refactored into a shared `runEvaluation` helper that retries, then on final failure writes a timeline row with `status: "failed"`, `attempts`, and a redacted error (capped at 300 characters).

**A failure never creates an `AIEvaluation` row.** The failure payload carries no `overall`, `score`, `recommendation`, `reasoning` or `confidence` — a unit test asserts each of those keys is absent. `Application.stage` is untouched on both paths, and `advisoryOnly: true` is preserved.

`GET /api/interviews/[id]` now returns `evaluationStatus`, and the dashboard page derives the same value. `interview-report.tsx` renders three distinct states:

- **pending** (warning style): "Final evaluation is being generated… This usually takes a couple of minutes" + **Generate now**
- **failed** (destructive style): "AI evaluation failed — no score was produced", with attempt count and the redacted reason + **Retry evaluation**
- **completed**: the evaluation itself

Retry reuses the existing staff-only `POST /api/interviews/[id]/regenerate-evaluation` route — no new endpoint, no new queue.

### Verification

25 unit tests in `tests/unit/evaluation-status.test.ts`, all passing, covering: bounded retry, retry exhaustion, non-retry of validation errors, retry of an Ollama outage, failure record shape, **no fabricated score in any state** (exhaustive over 18 state combinations), error redaction and truncation, and pending/failed/completed/not-applicable derivation including "a later success supersedes an earlier failure".

### Verification — database-backed (23 tests, `tests/isolation/evaluation-failure.test.mjs`)

All 23 pass against the real API and database:

| Group | Assertions |
|---|---|
| Pending is not reported as failed | completed interview with no evaluation reads `pending`, carries no error or attempt count |
| A recorded failure is durable | API reports `failed`, `attempts: 3`, a readable reason, `canRetry: true`; survives repeated reads; the row is in the database with `advisoryOnly: true` |
| Nothing is fabricated | **0 `AIEvaluation` rows** for the failed session; `overall: null`; the payload contains no `overall`/`score`/`recommendation`/`reasoning`/`confidence`; `evaluationStatus` leaks no score |
| Advisory-only preserved | `Application.stage` and `.status` unchanged; no `ProctoringEvent` created; `advisoryOnly: true` still advertised |
| A real evaluation supersedes | state flips to `completed`; **the failure audit row is not deleted**; the real evaluation is returned |
| Retry is staff-only | anonymous 401, candidate 403, detail endpoint 401 |
| In-progress interviews | read as `not_applicable` with `canRetry: false`, so no alarm mid-interview |

### Verification — live end-to-end with the AI down (19 assertions)

A real interview was created and partly answered with Ollama up, then Ollama was taken down and the interview driven to conclusion:

| Assertion | Result |
|---|---|
| Interview + plan created | PASS |
| 2 turns answered before the outage | PASS |
| **Candidate could finish the interview with the AI down** | PASS — `sessionStatus=COMPLETED`, graceful degradation preserved |
| Failure recorded after bounded retry | PASS — 15 s, `attempts=3` |
| **Retry bounded at exactly 3 attempts** | PASS |
| Marked `advisoryOnly` | PASS |
| **Nothing fabricated** | PASS — payload keys were exactly `kind, error, status, attempts, sessionId, advisoryOnly` |
| No `AIEvaluation` row created | PASS — before 0, after 0 |
| No `INTERVIEW_OVERALL` exists | PASS |
| API reports `state: "failed"` | PASS |
| API returns `overall: null` | PASS |
| **Application stage untouched** | PASS — `APPLIED/ACTIVE` → `APPLIED/ACTIVE` |
| Exactly one new `AI_EVALUATION` row | PASS |
| Operator retry after recovery | PASS — HTTP 200, real evaluation in 141 s, `recommendation=MAYBE overall=65` |
| State flips to `completed` | PASS |
| Failure audit row retained | PASS |
| Stage untouched throughout | PASS |

The recorded error was `Ollama /api/chat failed (404): {"error":"model 'qwen2.5:7b' not found"}` rather than a connection refusal, because a **native Windows Ollama** took over port 11434 when the container stopped (see section 20). That made the test stronger, not weaker: an unexpected upstream error still produced correct bounded-retry and durable-failure behaviour.

**R-3: PASS.**

---

## 6. R-10 — Secure cookie under HTTPS

### Findings

`setSessionCookie` used `secure: process.env.NODE_ENV === "production"`. `HttpOnly`, `SameSite=lax` and `Path=/` were already correct, and no domain was set (host-only, correct).

Two real gaps:

1. **The LAN pilot.** `scripts/lan-https-proxy.mjs` serves `https://<LAN>:3443` for the candidate and secondary-camera pages and sets `x-forwarded-proto: https`, but the Next process behind it runs `NODE_ENV=development`. Sessions issued over that TLS connection had **no `Secure` flag**.
2. **`clearSessionCookie`** used `cookies().delete()`, which does not reproduce the `Secure`/`SameSite` attributes; some browsers keep the original cookie when the clearing attributes do not match.

### Fix

New `src/lib/auth/cookie-options.ts` — a pure function with the rule `secure = isHttps || isProduction`:

- Production stays Secure even behind a proxy that omits `x-forwarded-proto`, so a misconfigured deployment cannot silently downgrade.
- LAN HTTPS on a development build now gets Secure.
- Plain-HTTP localhost development stays non-Secure, because a Secure cookie over `http://` is dropped and login would break.

`setSessionCookie` derives `isHttps` from `x-forwarded-proto` via `requestIsHttps`, wrapped in try/catch for callers with no request scope. `clearSessionCookie` now sets an empty value with matching attributes and `maxAge: 0`.

`SameSite` deliberately stays `lax`, not `strict`: the candidate arrives on a magic link, which is a cross-site top-level navigation that `strict` would drop. The JWT/session architecture is unchanged.

### Verification

14 unit tests in `tests/unit/session-cookie.test.ts`, all passing: the four Secure combinations, HttpOnly/SameSite/path/no-domain/TTL invariants, clear-options mirroring, and proto detection including proxy chains (`"https, http"` → true) and malformed input.

### Verification — live, full matrix

Real logins against a running server, cookie values captured verbatim (JWT redacted):

| Server mode | Transport | `Set-Cookie` | Verdict |
|---|---|---|---|
| production (`next start`) | plain HTTP | `Path=/; Max-Age=43200; **Secure**; HttpOnly; SameSite=lax` | PASS — fail-safe, never sends a session in the clear |
| production | `x-forwarded-proto: https` | `… Secure; HttpOnly; SameSite=lax` | PASS |
| development (`next dev`) | plain HTTP `localhost:3000` | `Path=/; Max-Age=43200; HttpOnly; SameSite=lax` — **no Secure** | PASS — dev login works |
| development | `x-forwarded-proto: https` | `… Secure; …` | **PASS — this is the gap R-10 closed** |
| development | **real TLS** `https://localhost:3443` (the LAN pilot proxy) | `… Max-Age=43200; **Secure**; HttpOnly; SameSite=lax` | **PASS — verified over actual TLS, not a simulated header** |

Supporting live assertions, all passing: login succeeds, cookie is `HttpOnly`/`SameSite=Lax`/`Path=/`, logout clears it (`Max-Age=0`), `/api/auth/me` works with the issued cookie and leaks no `passwordHash`, and a failed login sets no cookie at all.

The production-over-plain-HTTP row is worth noting operationally: a production build served without TLS sets `Secure`, and a browser will then drop the cookie. That is deliberate — and it is **identical to the pre-R-10 behaviour** (`secure: NODE_ENV === "production"`), so it is not a change introduced here. The pilot is expected to run behind the HTTPS proxy.

**R-10: PASS.**

---

## 7. #15 — SECONDARY_DEVICE_INTERACTION

**DEFERRED — NOT CLOSED.**

Not investigated, not modified, not tested. No physical run was performed. No change was made to interaction thresholds, interaction geometry, warning-pause behaviour, R5, R7 or R8.

Unchanged and still true from the UAT: **#13 `SECONDARY_DEVICE_VISIBLE` PASS on real hardware**, candidate-facing warning **PASS**, STANDARD warn-only protection **PASS**.

---

## 8. Tests added

| File | Tests | Covers |
|---|---|---|
| `tests/unit/security-headers.test.ts` | 23 | R-1 CSP directives, dev vs prod, HSTS gating, Permissions-Policy, nonce uniqueness, static-asset headers |
| `tests/unit/health-payload.test.ts` | 15 | R-2 public/detailed split, disclosure sweep over 12 secrets, consumer-shape preservation, readiness semantics |
| `tests/unit/evaluation-status.test.ts` | 25 | R-3 bounded retry, retry exhaustion, no fabrication, redaction, state derivation |
| `tests/unit/session-cookie.test.ts` | 14 | R-10 Secure matrix, cookie invariants, clear-options, proto detection |
| `tests/isolation/production-hardening.test.mjs` | 37 | live headers, nonce coverage, HSTS, public health disclosure, full cookie matrix |
| `tests/isolation/evaluation-failure.test.mjs` | 23 | R-3 against the real API + database: durability, no fabrication, stage invariance, supersession, staff-only retry |
| `backend/common/tests/test_health_disclosure.py` | 8 | Django public health disclosure, failure paths, status semantics |

**Total added: 145 test cases**, all executed and passing (194 unit − 117 baseline = 77 new unit; 99 isolation − 39 baseline = 60 new isolation; 168 Django − 160 baseline = 8 new Django), plus 19 live end-to-end R-3 outage assertions.

---

## 9. Full regression results

| Suite | Baseline | Now | Result |
|---|---|---|---|
| Unit (`tsx --test tests/unit/*.test.ts`) | 117 | **194** | **194 pass, 0 fail** |
| Isolation (`tests/isolation/*.test.mjs`) | 39 | **99** | **98 pass, 0 fail, 1 mode-gated skip** |
| Django (`manage.py test --parallel 4`) | 160 | **168** | **168 pass, 0 fail** |
| **Total** | **316** | **461** | **460 pass, 0 fail, 1 mode-gated skip** |

Plus **19 live end-to-end R-3 outage assertions**, all passing (not committed as a test because it stops a Docker container).

The isolation suite was run twice — once against the production build (`next start`, `UAT_SERVER_MODE=production`) and once against the dev build (`next dev`, `UAT_SERVER_MODE=development`). Both runs: **99 tests, 98 pass, 0 fail, 1 skipped.** The single skip is the mode-specific cookie assertion, which is gated to the opposite mode and passes in its own run — so every one of the 99 cases passed in at least one mode and none failed in either.

Counts rose 316 → 461 (+145) purely from new tests. **No existing test was modified, replaced or deleted.** Two tests I had written in the earlier pass were corrected — see section 20; both were harness bugs, not product changes.

---

## 10. Build result

```
npm run build   →   BUILD_EXIT=0   ✓ Compiled successfully
npx tsc --noEmit →  clean, 0 errors
npm run lint    →   0 errors, 2 pre-existing no-img-element warnings
```

Exit code captured directly into a variable, not through a pipe. `next start` booted the resulting build and served real traffic on every route exercised.

Route-rendering change: `/login` and `/register` moved from `○ (Static)` to `ƒ (Dynamic)`. This is required by the nonce'd CSP and is the only rendering change. Every other route was already dynamic.

Re-verified with the full stack up: `BUILD_EXIT=0`, `✓ Compiled successfully`, `/login` and `/register` both `ƒ`, middleware 33.1 kB. `next start -p 3000` booted and served the entire isolation suite.

**Docker image rebuild: NOT TESTED** — out of scope for this pass; the app image was not rebuilt. `docker/app/entrypoint.sh` is unmodified and the four dependency containers all run healthy.

---

## 11. Security verification

| Check | Verdict | Evidence |
|---|---|---|
| CSP present on pages and APIs | PASS | live headers |
| CSP blocks nothing the app needs | PASS | browser: 0 console errors; WASM compiled (154 exports); dynamic import, `data:` image and `blob:` URL all OK |
| Framing denied | PASS | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| nosniff, Referrer-Policy | PASS | live |
| HSTS only over HTTPS | PASS | absent on HTTP, present with `x-forwarded-proto: https` |
| Camera/mic preserved | PASS | `Permissions-Policy: camera=(self), microphone=(self)` |
| Framework not advertised | PASS | `x-powered-by` absent, `poweredByHeader: false` |
| Public health leaks nothing | PASS | 10/10 secret strings absent, including on the failure path |
| Django health leaks nothing | PASS | 8/8 tests; live payload is `{ok, django{ok}, postgres{ok}, redis{ok}, celery{ok}}` |
| Cookie Secure over real TLS | PASS | `https://localhost:3443` → `Secure; HttpOnly; SameSite=lax` |
| No passwordHash or JWT in staff payloads | PASS | 0 hits across `/api/candidates`, `/api/applications`, `/api/jobs`, `/api/admin/users`, `/api/auth/me`, `/api/health` |
| No new security issue introduced | PASS | no auth logic altered; middleware auth/RBAC flow byte-for-byte preserved apart from added headers |

---

## 12. Database safety verification

| Check | Result |
|---|---|
| `prisma/schema.prisma` modified | **No** — `git diff HEAD -- prisma/schema.prisma` empty |
| Migrations added or altered | **No** |
| Destructive Prisma commands run | **None** — no `db push`, no `--accept-data-loss`, no reset, no migrate |
| UAT evidence deleted | **No** |
| Unrelated modified files overwritten | **No** — only the files in section 16 were edited |
| Data written by this pass | TEST data only — one interview session for the R-3 live outage test (kept as evidence, see section 18); all isolation-test rows cleaned up by their own `after()` hooks |
| `prisma migrate diff` | **No difference detected** — live schema matches `schema.prisma` |

R-3 records failures in the existing `TimelineEvent` table using the existing `AI_EVALUATION` enum value, which is precisely why no schema change was required.

---

## 13. Regression verification of F-01 through R8

Re-executed against the live stack after Docker was restored. Every suite below was actually run.

| Item | Status | Basis |
|---|---|---|
| F-01 container startup | **PASS** | `docker/app/entrypoint.sh` unmodified; `BUILD_EXIT=0` and `next start` served the full isolation suite |
| F-02 deactivated sessions | **PASS** | 5 isolation tests executed against the live app; only the cookie *writer* changed, not `getSession()` |
| F-03 job department | **PASS** | 9 unit tests |
| F-04 dependency outage | **PASS** | 12 Django tests executed as part of the 168 |
| F-05 R1 baseline | **PASS** | `secondary-integrity-client.ts` unmodified; audit-evidence isolation tests pass live |
| F-05 R2 episodes | **PASS** | 21 unit tests; `secondary-integrity-cv.ts` unmodified |
| F-05 R5 STANDARD warn-only | **PASS** | `integrity.ts`, `integrity-server.ts` unmodified; **0 terminations of any mode** recorded after the R5 fix timestamp |
| Audit evidence durability | **PASS** | 12 isolation tests executed live, including reconnect, idempotency and post-disconnect retention |
| R6.1/R6.2 model + vocabulary | **PASS** | 8 unit tests; `efficientdet_lite2` served and **compiled under the live CSP** (11 756 954 bytes, 154 WASM exports) |
| R7 presence continuity | **PASS** | 20 unit tests pass; helper untouched |
| R8 box memory | **PASS** | 19 unit tests pass; helper untouched |

The one file in this list touched at all is `src/lib/auth/session.ts`, and only its cookie-writing functions. `getSession`, `verifySessionToken` and `isAccountEnabled` — the F-02 fix — are unchanged.

Proctoring source files were confirmed untouched by this pass (file mtimes all predate it):
`secondary-integrity-client.ts`, `secondary-integrity-cv.ts`, `integrity.ts`, `integrity-server.ts`, `secondary-camera-client.tsx`, `secondary-recording.ts`, `secondary-recording-server.ts`.

Live database invariants:

| Invariant | Result |
|---|---|
| Stage changes driven by proctoring | **0** |
| Terminations after the R5 fix | **0** (of any mode) |
| `SECONDARY_DEVICE_VISIBLE` / `SECONDARY_DEVICE_REMOVED` | **10 / 7** — #13 evidence intact |
| `SECONDARY_DEVICE_INTERACTION` | **0** — #15 unchanged, untouched |

---

## 14. Integration verification

Executed against the live stack.

### Service health (all green, captured together)

| Service | Evidence |
|---|---|
| Next.js | `{"ok":true,"service":"Logisoft HireOS","database":{"ok":true},"ollama":{"ok":true},"speech":{"ok":true}}` |
| Django | `{"ok":true,"django":{"ok":true},"postgres":{"ok":true},"redis":{"ok":true},"celery":{"ok":true}}` |
| PostgreSQL | `/var/run/postgresql:5432 - accepting connections` |
| Redis | `PONG` |
| Ollama | HTTP 200, `qwen2.5:7b` + `nomic-embed-text` present |
| Speech | `{"ok":true,"device":"cpu","whisperModel":"small","voice":"en_US-lessac-medium","piperReady":true}` |
| **Celery** | **`1 node online`** — `celery@DESKTOP-9177HSA`, exactly one worker as required |

### Areas

| Area | Verdict | Evidence |
|---|---|---|
| Login / logout / auth-me | **PASS** | live isolation tests; `/api/auth/me` returns no `passwordHash` |
| Invalid credentials | **PASS** | 401, and **no cookie is set** |
| Deactivated session | **PASS** | 5 F-02 isolation tests |
| Security headers | **PASS** | live on pages, APIs and 401 responses |
| Health disclosure (Next + Django) | **PASS** | live payloads boolean-only |
| Cookie attributes | **PASS** | full matrix incl. real TLS on :3443 |
| AI evaluation success / outage / retry / failure state | **PASS** | 23 database-backed + 19 live outage assertions |
| Jobs, candidates, applications, stage, timeline | **PASS** | covered by the 99-test isolation suite; no code in these paths modified |
| TEXT interview + finalization | **PASS** | exercised end to end by the R-3 live test (interview created, planned, answered, concluded, evaluated) |
| VOICE interview | **NOT TESTED** this pass | not modified; verified in the preceding full UAT |
| Recording / secondary camera / R1/R2/R5/#13 | **PASS (data + tests)** | 12 audit-evidence isolation tests; live DB invariants in section 13. No physical run, as instructed |
| Django health / DB / Redis / Celery / write paths | **PASS** | 168 Django tests + live health |
| Rollback flags | **NOT TESTED** this pass | not modified; verified in the preceding full UAT |
| Page renders under CSP | **PASS** | browser: 0 console messages, full hydration |
| MediaPipe WASM under CSP | **PASS** | compiled, 154 exports |

---

## 15. Remaining risks

H-1 through H-4 from the interim report are **closed** — all 461 tests executed, and R-3, R-10 and the Django health hardening are all verified. What remains:

| # | Severity | Item | Blocks production? |
|---|---|---|---|
| **H-5** | Low | `style-src` retains `'unsafe-inline'`. Next streams inline critical CSS and React emits `style` attributes, which a nonce does not cover. Removing it would require rewriting component styling — out of scope, and this is the strongest safe policy for the current architecture. | No |
| **H-6** | Low | `/login` and `/register` are no longer statically cached. Two tiny pages, now consistent with every other route in the app. | No |
| **H-7** | Info | A future statically pre-rendered page would silently break under the nonce'd CSP. `tests/isolation/production-hardening.test.mjs` guards this by asserting zero un-nonced inline scripts on the public pages. | No |
| **H-8** | Info | A production build served over plain HTTP sets `Secure`, so browsers drop the cookie and login fails. Deliberate fail-safe, and identical to the pre-R-10 rule. Run the pilot behind TLS. | No |
| **H-9** | Low (operational) | A **native Windows Ollama** is installed alongside the container and competes for port 11434. When the container stops, the native instance answers without the models. See section 20. | No — but it will confuse future outage testing |
| **#15** | **DEFERRED — NOT CLOSED** | `SECONDARY_DEVICE_INTERACTION` — not investigated, not modified, not tested, no physical run. | No |

### Out-of-scope issues observed and NOT modified

- **`_prisma_migrations` still absent** (audit item R-4). The database is provisioned by `db push` by design; `prisma migrate deploy` cannot run without baselining first. Documented, not touched.
- **Two Ollama instances on this host** (H-9). Not a repository issue; recorded for the operator.

---

## 16. Exact files changed

**New (13):**

```
src/lib/security-headers.ts
src/lib/health-payload.ts
src/lib/auth/cookie-options.ts
src/lib/ai/evaluation-status.ts
src/app/login/login-screen.tsx
src/app/register/register-screen.tsx
tests/unit/security-headers.test.ts
tests/unit/health-payload.test.ts
tests/unit/evaluation-status.test.ts
tests/unit/session-cookie.test.ts
tests/isolation/production-hardening.test.mjs
tests/isolation/evaluation-failure.test.mjs
backend/common/tests/test_health_disclosure.py
docs/HIREOS_FINAL_PRODUCTION_HARDENING.md
```

**Modified (10):**

| File | Change | Item |
|---|---|---|
| `src/middleware.ts` | apply security headers to every exit path; forward nonce | R-1 |
| `next.config.mjs` | `poweredByHeader: false`; `headers()` for static/mediapipe | R-1 |
| `src/app/layout.tsx` | read `x-nonce`, pass to `Providers` | R-1 |
| `src/components/providers.tsx` | accept and forward `nonce` to `next-themes` | R-1 |
| `src/app/login/page.tsx` | server wrapper, `force-dynamic` | R-1 |
| `src/app/register/page.tsx` | server wrapper, `force-dynamic` | R-1 |
| `src/app/api/health/route.ts` | public/detailed split | R-2 |
| `backend/common/views.py` | `_public()` reduction, top-level `ok` | R-2 |
| `src/lib/ai/process-answer-turn.ts` | `runEvaluation` with bounded retry + failure record | R-3 |
| `src/app/api/interviews/[id]/route.ts` | return `evaluationStatus` | R-3 |
| `src/app/dashboard/interviews/[id]/page.tsx` | derive and pass `evaluationStatus` | R-3 |
| `src/components/interview-report.tsx` | pending vs failed states, retry button | R-3 |
| `src/lib/auth/session.ts` | HTTPS-aware Secure; attribute-matched clear | R-10 |

No other file in the working tree was touched. `prisma/schema.prisma`, `.env`, and every file from the previous remediations are unchanged.

---

## 17. Commands and tests run

Implementation pass:

```bash
npx tsx --test tests/unit/security-headers.test.ts      # 23 pass
npx tsx --test tests/unit/health-payload.test.ts        # 15 pass
npx tsx --test tests/unit/session-cookie.test.ts        # 14 pass
npx tsx --test tests/unit/evaluation-status.test.ts     # 25 pass
```

Completed verification pass, full stack up:

```bash
npm run build                                           # BUILD_EXIT=0
npx next start -p 3000                                  # booted, served every suite
npx tsx --test tests/unit/*.test.ts                     # 194 pass, 0 fail
BASE_URL=http://localhost:3000 UAT_SERVER_MODE=production   npx tsx --test tests/isolation/*.test.mjs             # 99 tests: 98 pass, 0 fail, 1 skip
BASE_URL=http://localhost:3000 npx tsx --test tests/isolation/evaluation-failure.test.mjs
                                                        # 23 pass, 0 fail
cd backend && python manage.py test --parallel 4        # 168 pass, OK
npx tsc --noEmit                                        # clean
npm run lint                                            # 0 errors, 2 warnings
npx prisma migrate diff …                               # No difference detected

# development-mode half of the R-10 matrix
npm run dev
BASE_URL=http://localhost:3000 UAT_SERVER_MODE=development   npx tsx --test tests/isolation/*.test.mjs             # 99 tests: 98 pass, 0 fail, 1 skip

# live R-3 outage: real interview concluded with Ollama stopped   # 19 assertions, all pass
# live R-10: real TLS login through https://localhost:3443        # Secure present
# celery -A config inspect ping                                    # 1 node online
```

---

## 18. Unresolved

1. **#15 `SECONDARY_DEVICE_INTERACTION`** — DEFERRED by instruction. Not investigated, not modified, not tested.
2. **VOICE interview and Django rollback flags** were not re-exercised this pass. Neither was modified; both passed in the preceding full UAT.
3. **Docker app-image rebuild** was not performed — out of scope for this pass.
4. **`_prisma_migrations` baseline** (audit R-4) remains open by design.
5. **Two Ollama instances on the host** (H-9) — operator cleanup, not a code issue.

### Test data left behind

One interview session, `cmsx3w7l5000bux4itdln83oc`, was created by the live R-3 outage test and deliberately kept: it holds the failure audit row, the subsequent successful evaluation, and the proof that the stage never moved. Delete it when the evidence is no longer needed. All other test rows were cleaned up by their own `after()` hooks.

---

## 19. Final recommendation

# GO — PRODUCTION READY

All four approved hardening items are implemented, minimally and test-first, and **all four are verified against the complete running stack**:

- **R-1** — strict, nonce-based CSP plus the full header set, verified live on pages, APIs and error responses, in a real browser with zero console violations, and with direct proof that MediaPipe's WebAssembly still compiles under it. The one thing that would have broken — statically pre-rendered pages with un-nonced inline scripts — was caught by inspecting rendered HTML and fixed.
- **R-2** — the unauthenticated health endpoints on both stacks are boolean-only, verified live and by 8 Django tests, with every existing consumer's expected shape preserved.
- **R-3** — proven end to end by concluding a real interview with the AI unreachable: bounded retry at exactly 3 attempts, a durable typed failure record, nothing fabricated, no `AIEvaluation` row, stage untouched, and a successful operator retry after recovery.
- **R-10** — the full Secure matrix verified in both server modes, including a real TLS login through the LAN pilot proxy on `:3443`.

**461 tests pass, 0 fail** (194 unit, 99 isolation, 168 Django), plus 19 live outage assertions. Build exits 0, lint 0 errors, TypeScript clean, Prisma schema unchanged and drift-free, no destructive database operation performed, and no `passwordHash` or JWT leaks on any staff surface.

No regression was introduced. Every prior remediation (F-01…F-05, R1/R2/R5, R6, R7, R8) re-verified green, `#13` evidence intact, and no proctoring or interview source file was touched.

**#15 `SECONDARY_DEVICE_INTERACTION` remains DEFERRED — NOT CLOSED, and is explicitly not blocking this hardening pass.**

Two items for the operator, neither blocking: run the pilot behind TLS (H-8), and remove the duplicate native Ollama that competes for port 11434 (H-9).

---

## 20. Failures seen during the completion pass

Both failures below were investigated to root cause. **Neither was a regression from R-1, R-2, R-3 or R-10**, and no application code was changed in response to either.

### 20.1 `npm run build` exited 1 with `PageNotFoundError: /_document`

| | |
|---|---|
| **Test** | `npm run build` (first attempt of the completion pass) |
| **Expected** | exit 0 |
| **Actual** | `✓ Compiled successfully`, then during *Collecting page data*: `unhandledRejection Error [PageNotFoundError]: Cannot find module for page: /_document`, exit 1 |
| **Severity** | Blocking at the time, zero residual |
| **Root cause** | A stray `next dev -H 0.0.0.0` (pid 14948, plus its child start-server pid 11180) was still running against this repository and writing into `.next` while the build read from it. Two Next processes sharing one `.next` directory. There is no `pages/` directory in the project, so `/_document` could only come from a corrupted build manifest. |
| **Regression from R-1/R-2/R-3/R-10?** | **No.** The identical source tree had already built with exit 0 three times. |
| **Files involved** | none — process collision only |
| **Resolution** | Stopped the stray processes, `rm -rf .next`, rebuilt: **exit 0**. |

### 20.2 R-3 live recovery: `model 'qwen2.5:7b' not found`

| | |
|---|---|
| **Test** | `R3-LIVE-16` / `R3-LIVE-17` — operator retry after Ollama recovery |
| **Expected** | HTTP 200 and an `INTERVIEW_OVERALL` evaluation; `evaluationStatus.state` → `completed` |
| **Actual** | HTTP 503 `Ollama /api/chat failed (404): {"error":"model 'qwen2.5:7b' not found"}`; state stayed `failed` |
| **Severity** | Low, environmental |
| **Root cause** | A **native Windows Ollama** (`ollama app.exe` pid 22164, `ollama.exe` pid 3524) is installed alongside the `aros-ollama` container. Both want port 11434. When the test stopped the container, the native instance took the port — and it has no models — so requests got a 404 instead of a connection refusal. The container had not finished reclaiming the port when the retry ran. |
| **Regression from R-1/R-2/R-3/R-10?** | **No.** It is a host port-ownership race between two Ollama installations. It arguably strengthened the R-3 evidence: an unexpected upstream error still produced correct bounded-retry and durable-failure behaviour. |
| **Files involved** | none |
| **Resolution** | Once the container reclaimed 11434, the same two assertions were re-run unchanged: **PASS** — HTTP 200, real evaluation in 141 s (`recommendation=MAYBE overall=65`), state `completed`, failure audit row retained, stage untouched. |

### 20.3 Two test-harness bugs I fixed (my tests, not application code)

- **`skip` evaluated too early.** `node:test` resolves the `skip` option while *collecting* tests, before any `before()` hook runs, so a hook-assigned `dbUp` flag was always still `false` and all 7 cookie tests silently skipped even with Postgres up. Fixed by resolving the health probe with top-level `await` at module load.
- **Wrong `NODE_ENV` read.** A test guarded on `process.env.NODE_ENV` of the *test runner* to decide whether `Secure` should be present, but the mode that matters is the *server's*. Replaced with an explicit `UAT_SERVER_MODE` input, and the suite is now run once per mode.

Both were defects in tests written during the implementation pass. No product behaviour changed.
