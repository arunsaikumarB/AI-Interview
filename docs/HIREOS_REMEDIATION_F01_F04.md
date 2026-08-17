# LOGISOFT HIREOS — REMEDIATION F-01 … F-04

**Date:** 2026-08-16
**Input:** [docs/HIREOS_FULL_INTEGRATION_UAT.md](HIREOS_FULL_INTEGRATION_UAT.md)
**Scope:** the four confirmed findings only. Phase 4C.4 was not started.
**Prisma schema:** not modified. `--accept-data-loss` was never run. No enum value was removed.

---

## 1. Summary

All four findings are fixed and verified. The complete regression suite passes: **221 tests, 0 failures** (up from 176), and `npm run build` now succeeds — **for the first time since Phase 4A**.

| ID | Status | Verified by |
|---|---|---|
| **F-01** BLOCKER — packaged pilot cannot start | **FIXED** | Pilot starts against the existing database; database provably untouched; fresh-install bootstrap re-proven |
| **F-02** HIGH — deactivated user keeps staff API access | **FIXED** | Original audit attack now 401 everywhere; 5 new regression tests |
| **F-03** MEDIUM — Job edit silently clears Department | **FIXED** | Browser end-to-end before/after; 9 new regression tests |
| **F-04** MEDIUM — Redis down returns 500 + DEBUG traceback | **FIXED** | Clean 503, no internals; 12 new regression tests |

### Correction to the audit

The audit recorded F-01's cause as "the image is stale". That was correct but **incomplete**, and one statement in the audit session was wrong: an image rebuild was reported as succeeding when it had not. The build command was piped to `tail`, so the shell reported `tail`'s exit status instead of docker's. The real cause is one level deeper and is documented in §2.

---

## 2. F-01 — Packaged pilot cannot start

### 2.1 Root cause

Three defects in a chain. The audit saw the last one.

**(a) `npm run build` had been broken since Phase 4A — 60 ESLint errors.**

`next build` runs ESLint and fails the build on any error. The Phase 4A–4C cutover introduced five flag helpers named `useDjangoReads`, `useDjangoAsync`, `useDjangoStageWrites`, `useDjangoJobWrites`, `useDjangoAdminWrites`. They are ordinary server-side functions, but `eslint-plugin-react-hooks` treats **any** `use*()` call as a React Hook:

```
./src/app/api/jobs/route.ts
65:9  Error: React Hook "useDjangoReads" cannot be called in an async function.  react-hooks/rules-of-hooks
```

56 such false positives across 20 API route files, one async server component and one server loader, plus 4 real `@typescript-eslint/no-unused-vars` errors on deliberately `_`-prefixed discards (`_ignored`, `_ignoredOrg`).

**(b) A pre-existing TypeScript error also failed the build.**

`src/app/api/applications/[id]/interviews/route.ts:256` annotated a local as `kind: "INTERVIEW_PLAN"` while `enqueueDjangoJob` returns the wider `AsyncJobKind` union.

**(c) Therefore the image could never be rebuilt — which is *why* it was stale.**

The image on disk predates Phase 4A, so it carries a `prisma/schema.prisma` with 6 `SECONDARY_*` enum values while the working tree and live database have 15. The entrypoint then ran `prisma db push` against the live database on **every** boot, Prisma correctly refused (it would drop 9 values), and the retry loop treated that refusal as "database not ready", retried 30 times and exited.

**(d) Aggravating design flaw.** The entrypoint conflated two concerns — *wait for the database* and *apply the schema* — into a single `until prisma db push; do ... done` loop. A schema mutation ran automatically on every container start, and the error message advertised `--accept-data-loss` as the remedy. Applying that would have dropped enum values the current application still emits.

### 2.2 The fix

**`.eslintrc.json`** — narrowly scoped overrides so the false positives stop failing the build without weakening real checks:

- `react-hooks/rules-of-hooks` off for `src/app/api/**` (route handlers cannot contain React), plus two named server files (`src/app/dashboard/interviews/*/page.tsx`, `src/lib/staff-reads/jobs-hub.ts`).
- `@typescript-eslint/no-unused-vars` configured with `^_` ignore patterns inside `src/app/api/**`, matching the convention the code already uses.

The rule **remains active everywhere else**, including `src/lib/staff-async/use-staff-async-poll.ts`, which is a genuine React hook. Renaming the five helpers would be the better long-term fix; it was rejected here because it touches ~20 files plus their unit tests, which is far outside this remediation.

**`src/app/api/applications/[id]/interviews/route.ts`** — use the exported type instead of a hand-narrowed literal:

```ts
let asyncPlan: AsyncEnqueueResult | null = null;
```

**`docker/app/entrypoint.sh`** — rewritten to separate readiness from schema application:

1. **Wait** for the database with a non-mutating probe (`SELECT 1` via `prisma db execute`).
2. **Detect** whether a schema already exists (`SELECT 1 FROM "User" LIMIT 1`).
3. **Empty database** → bootstrap with `prisma db push` (fresh installs still work).
4. **Populated database** → **skip the push** and log why. A populated database holds real rows and is not something a container image should silently reshape.
5. **Opt-in override** `HIREOS_DB_PUSH=true` for a deliberate, reviewed push. If it fails, the entrypoint prints an explicit instruction to rebuild the image and states that `--accept-data-loss` must not be used.

`--accept-data-loss` appears nowhere. No enum value is removed. `prisma/schema.prisma` is unchanged.

One incidental correction in the same file: seeding invoked `tsx prisma/seed.ts`, but `tsx` is not copied into the runner image (the Dockerfile bundles `dist/docker/seed.cjs` for exactly this reason). It was silently no-oping behind `|| true`. Now it calls the bundled `node dist/docker/seed.cjs`.

### 2.3 Verification

Image rebuilt with the exit code checked directly (`DOCKER_BUILD_EXIT=0`), not through a pipe.

**Started against the existing, populated database:**

```
[app] Waiting for database…
[app] Database reachable.
[app] Existing schema detected — skipping db push (set HIREOS_DB_PUSH=true to force).
[app] Starting Next.js on :3000
```

| Check | Before | After |
|---|---|---|
| Container state | retry loop 10/30, never served | `Up`, serving |
| `/api/health` | no response | **200**, db + ollama + speech all ok |
| `/login` | — | 200 |
| Login → staff APIs | — | 200 on me/jobs/candidates/applications/analytics |
| CANDIDATE on staff API | — | 403 |
| Deactivated token (F-02 in the image) | — | 401 |
| Isolation suite against the container | — | **27/27 pass** |

**Database provably untouched** (identical before and after start):

| Fingerprint | Before | After |
|---|---|---|
| `ProctoringSignalType` values | 26 | **26** |
| `SECONDARY_*` values | 15 | **15** |
| ProctoringEvent / Job / User / Application | 359 / 6 / 11 / 21 | **359 / 6 / 11 / 21** |

**Fresh-install path re-proven.** The image was run against a throwaway empty database to exercise the bootstrap branch:

```
[app] Empty database detected — bootstrapping schema with prisma db push…
🚀  Your database is now in sync with your Prisma schema. Done in 431ms
[app] Schema bootstrap complete.
```

The schema that image creates: **26 enum values, 15 `SECONDARY_*`, 18 tables** — identical to the live database. This is the direct proof the drift is gone: a forced `HIREOS_DB_PUSH=true` would now be a no-op. The probe database was dropped afterwards.

---

## 3. F-02 — Deactivated user retains staff API access

### 3.1 Root cause

`src/lib/auth/rbac.ts` guards (`requireUser` → `requireStaff` / `requireRoles`) authorise from the **JWT claims alone**. A signed `aros_session` cookie proves who minted it, not that the account is still permitted, and nothing revokes an already-issued cookie. A user deactivated in the admin console therefore kept every staff API until the token expired — up to `AUTH_TOKEN_TTL_HOURS` (12h).

Only `GET /api/auth/me` read `isActive`, which is exactly why the audit saw that one endpoint return 401 while `/api/jobs`, `/api/candidates`, `/api/applications` and `/api/analytics` all returned 200 with real data.

Django was never affected: its bridge re-reads the `User` row on every request under `HIREOS_ENFORCE_PRISMA_USER_STATUS` (default true).

### 3.2 The fix

`src/lib/auth/session.ts` — `getSession()` now confirms the account is present and enabled after verifying the token:

```ts
async function isAccountEnabled(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  return user?.isActive === true;
}
```

`getSession()` is the single chokepoint used by all 74 server modules that authenticate, and nothing calls `verifySessionToken` directly, so one change covers every staff route, server component and portal route.

**Design decisions:**

- **The `aros_session` format and JWT architecture are unchanged.** No new claim, no new cookie, no token rewrite, no re-issue. Only an authorisation-time lookup was added.
- **Database errors are deliberately not swallowed.** They propagate so `handleApiError` still maps a Postgres outage to 503. Returning `null` there would have turned an outage into a misleading 401.
- **Only `isActive` is checked.** The role is still taken from the token, preserving the documented Phase 4C.3 behaviour that a role change requires re-login. Re-validating the role is a separate finding (W-12) and was out of scope.
- **`middleware.ts` was not touched.** It runs on the edge runtime and cannot use Prisma; it already inlines its own `jose` verification and does not import `session.ts`.

**Cost:** one indexed primary-key lookup per authenticated request — the same thing Django already does.

### 3.3 Verification

The exact attack from the audit, replayed against the still-deactivated user `temp-deact-1786508350082@local.dev` (`isActive = false`):

| Endpoint | Audit (before) | After |
|---|---|---|
| `/api/auth/me` | 401 | **401** |
| `/api/jobs` | **200** | **401** |
| `/api/candidates` | **200** | **401** |
| `/api/applications` | **200** | **401** |
| `/api/analytics` | **200** | **401** |

No regression for legitimate users: active recruiter 200 on all endpoints, and fresh login returns 200 for **all six roles** (SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER, CANDIDATE).

### 3.4 Tests added

`tests/isolation/deactivated-session.test.mjs` — 5 tests, wired into `npm run test:isolation`:

1. active staff user reaches all staff APIs (guards against over-blocking)
2. same cookie → 401 on every staff API once deactivated
3. the 401 body leaks no candidate or credential data
4. reactivating restores access with the same cookie (not a permanent lockout)
5. a token for a **deleted** account is rejected

---

## 4. F-03 — Job edit silently clears Department

### 4.1 Root cause

In `src/components/job-form.tsx` the department control was an **uncontrolled** `<select defaultValue={initial?.departmentId ?? ""}>`, while the department list was fetched asynchronously in `useEffect` from `/api/org`.

React applies `defaultValue` only on the **first** render. At that moment `departments` is still `[]`, so no `<option>` carries the job's department id and the select settles on the empty `—` placeholder. When the options arrive on a later render React does not re-apply `defaultValue`, so the selection is never restored. The submit handler then read `String(form.get("departmentId") || "") || null` → **`null`**, and the API — correctly, since `departmentId` is nullable — cleared the field.

The result: **every** save from the Job editor wiped the department, whichever field the user actually meant to edit. API-level tests never caught it because the API only clears the department when explicitly told to.

### 4.2 The fix

**New `src/lib/jobs/department-select.ts`** — the selection logic as pure functions, so the failure mode is directly testable without a DOM (the repo has no jsdom or React Testing Library):

- `initialDepartmentValue(initial)` — value derived from the job, never from the loaded list.
- `departmentSelectOptions(departments, selectedId, selectedName)` — guarantees the selected department always has an `<option>`, including while the list is empty, and never duplicates it once the real list arrives.
- `departmentIdForSubmit(selectedId)` — `""` → `null`, so a deliberate clear still works.

**`src/components/job-form.tsx`** — the select is now **controlled** by React state seeded from the job:

```tsx
const [departmentId, setDepartmentId] = useState<string>(() =>
  initialDepartmentValue(initial),
);
...
<select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
```

and the payload uses `departmentIdForSubmit(departmentId)` instead of reading FormData. Because the state does not depend on the options being present, the async load can no longer reset it.

**`src/app/dashboard/jobs/[id]/page.tsx`** — passes `departmentName` so the preserved option shows its real label instead of a placeholder.

### 4.3 Verification — browser, end to end

Same job, same interaction as the audit reproduction. First, the control state:

| Probe | Audit (before) | After |
|---|---|---|
| select value on first render | `""` | **Engineering id** |
| select value after `/api/org` resolves | `""` | **Engineering id** |

Then a real save editing **only the title**:

| | Audit (before) | After |
|---|---|---|
| department before | Engineering | Engineering |
| select value at submit | `""` | Engineering id |
| **department after** | **`null` — cleared** | **Engineering — retained** |
| title saved | yes | yes |

The field is still fully editable — both deliberate operations were confirmed in the browser:

- Engineering → People: persisted as **People**
- People → `—`: persisted as **`null`**

### 4.4 Tests added

`tests/unit/job-form-department.test.ts` — 9 tests, including the exact case requested:

> **REGRESSION: existing department + edit another field → department unchanged**

which walks the real sequence — mount with an empty list, edit the title, let `/api/org` resolve mid-edit, submit — and asserts the payload carries the original department id and not `null`. The others cover the empty-list option, the unknown-name fallback, no duplication after load, deliberate clear, and deliberate change.

---

## 5. F-04 — Redis outage returns 500 with a DEBUG traceback

### 5.1 Root cause

The enqueue endpoints touch Redis twice: the NX lock/status keys (`services/*/locks.py`) and the Celery broker handoff. With Redis down both raise `redis.exceptions.ConnectionError`, which DRF does not recognise, so the exception escaped as an unhandled 500. With `DJANGO_DEBUG=true` Django rendered that as a **full traceback page** exposing settings, file paths and the Redis connection string:

```
HTTP 500
<!DOCTYPE html> … <title>ConnectionError at /api/v1/screening/</title> …
Error 10061 connecting to 127.0.0.1:6379 …
```

### 5.2 The fix

**New `backend/common/exception_handlers.py`** + `REST_FRAMEWORK["EXCEPTION_HANDLER"]` in `backend/config/settings/base.py`.

`hireos_exception_handler` maps connection-level Redis and Celery-broker failures to a clean 503 and delegates everything else to DRF unchanged:

```json
{ "detail": "Background task service unavailable", "code": "dependency_unavailable" }
```

**Design decisions:**

- **Works regardless of `DEBUG`.** DRF handles the exception before Django's debug renderer, so the fix does not depend on turning DEBUG off.
- **The exception message is never echoed.** It routinely embeds broker host, port and credentials. Only the exception *class name* is logged.
- **Deliberately narrow.** Only `redis.exceptions.ConnectionError` (which covers `BusyLoadingError`), `redis.exceptions.TimeoutError` and `kombu.exceptions.OperationalError`. Command-level errors such as `ResponseError` are bugs, not outages, and keep their 500 so they stay visible.
- **503, not 4xx and not 200.** A queue outage is the server's fault; 4xx would tell the caller to change the request and 200 would silently drop the job.
- Imports are defensive so a missing optional dependency cannot break error handling itself.

### 5.3 Verification

| | Before | After |
|---|---|---|
| Status | 500 | **503** |
| Body | HTML Django traceback page | `{"detail":"Background task service unavailable","code":"dependency_unavailable"}` |
| Leaks `6379` / `127.0.0.1` | yes | **no** |
| Leaks traceback / settings / paths | yes | **no** |
| Auth still enforced during the outage | — | **yes** (401 anonymous, 403 candidate) |

### 5.4 Tests added

`backend/common/tests/test_dependency_outage.py` — 12 tests (`SimpleTestCase`, no test database), using the real redis-py error message so the leak assertions are meaningful:

- **End-to-end** through the real URLconf and view: 503; exact clean JSON body; body asserted free of `Traceback`, `<!DOCTYPE`, `Django Version`, `6379`, `127.0.0.1`, `ConnectionError`, `site-packages`, `settings`; outage is not downgraded to a 4xx; an outage does not become an auth bypass.
- **Handler unit tests**: ConnectionError / TimeoutError / BusyLoadingError / kombu OperationalError → 503; detail never echoes the message; `ResponseError` and generic bugs are **not** masked as outages; `NotFound` → 404 and `ValidationError` → 400 still reach DRF.

---

## 6. Files changed

### Modified (7)

| File | Finding | Change |
|---|---|---|
| `docker/app/entrypoint.sh` | F-01 | Separate readiness probe from schema application; bootstrap only an empty database; opt-in `HIREOS_DB_PUSH`; use the bundled seed |
| `.eslintrc.json` | F-01 | Scoped overrides for the `useDjango*` false positives and `^_` discards |
| `src/app/api/applications/[id]/interviews/route.ts` | F-01 | `asyncPlan` typed as `AsyncEnqueueResult \| null` (build-blocking type error) |
| `src/lib/auth/session.ts` | F-02 | `getSession()` verifies the account is present and enabled |
| `src/components/job-form.tsx` | F-03 | Controlled department select seeded from the job |
| `src/app/dashboard/jobs/[id]/page.tsx` | F-03 | Pass `departmentName` to the form |
| `backend/config/settings/base.py` | F-04 | `EXCEPTION_HANDLER` → `common.exception_handlers.hireos_exception_handler` |
| `package.json` | tests | `test:isolation` includes the new suite; new `test:unit` script |

### Added (5)

| File | Purpose |
|---|---|
| `src/lib/jobs/department-select.ts` | F-03 pure selection logic |
| `backend/common/exception_handlers.py` | F-04 handler |
| `backend/common/tests/__init__.py` | package marker |
| `backend/common/tests/test_dependency_outage.py` | F-04 tests (12) |
| `tests/isolation/deactivated-session.test.mjs` | F-02 tests (5) |
| `tests/unit/job-form-department.test.ts` | F-03 tests (9) |

### Not changed

`prisma/schema.prisma` (no diff), the JWT/cookie format, `src/middleware.ts`, AI prompts, scoring, the interview engine, proctoring or secondary-camera architecture, and all five feature flags (`.env` md5 `0ee1ad3e97ad690a4a4fd79ea9d8925d`, unchanged, all flags false).

---

## 7. Before / after results

### Regression suite

| Suite | Before | After |
|---|---|---|
| Django (`manage.py test`) | 148 pass | **160 pass** (+12 F-04) |
| Django `manage.py check` | 0 issues | **0 issues** |
| Unit (`npm run test:unit`) | 6 wired (25 existed, unwired) | **34 pass** (+9 F-03, +19 previously unwired) |
| Isolation (`npm run test:isolation`) | 22 pass | **27 pass** (+5 F-02) |
| **Total** | **176** | **221, 0 failures** |
| `npx next lint` | **60 errors** | **0 errors** (2 pre-existing `<img>` warnings) |
| `npm run build` | **FAILED** | **succeeds** |
| Packaged pilot (`aros-app`) | **never starts** | **starts, serves, 27/27 isolation tests against it** |

### Finding-by-finding

| Finding | Before | After |
|---|---|---|
| F-01 | container loops `retry 10/30`, port 3000 dead | starts; skips db push; database byte-identical; fresh-install bootstrap works |
| F-02 | deactivated user → 200 on 4 staff APIs | **401 on all**; active users and all six logins unaffected |
| F-03 | title-only edit → `departmentId: null` | department retained; deliberate change and clear still work |
| F-04 | 500 + full DEBUG traceback | clean 503, no internals, auth still enforced |

---

## 8. Remaining risks

**Directly related to these fixes**

1. **F-02 adds one database query per authenticated request.** An indexed primary-key lookup, matching what Django already does, and uncached so deactivation takes effect immediately. If profiling ever shows pressure, a short-TTL cache would trade revocation latency for load — deliberately not added.
2. **F-02 changes behaviour during a Postgres outage.** Database errors propagate rather than being swallowed, so requests surface as 503 via `handleApiError` instead of 401. This is the intended semantics but it is a behaviour change; the audit's PostgreSQL-down scenario (RES-12) was never run and remains untested.
3. **The ESLint override is a workaround, not the real fix.** The correct fix is renaming the five `useDjango*` helpers to non-`use` names, which would let the rule apply everywhere. Until then, `react-hooks/rules-of-hooks` is off inside `src/app/api/**` and two named files, so a genuine hook mistake in an API route would not be caught. It remains active for all client components and real hooks.
4. **F-03's regression tests cover the logic, not the rendered DOM.** The repo has no jsdom or React Testing Library, so the pure helpers are tested and the component wiring was verified manually in the browser. A component-level test would need a new dev dependency.

**Pre-existing, unchanged by this work**

5. **`DJANGO_DEBUG=true`** in `backend/.env`. F-04 no longer depends on it, but it still disables `CSRF_COOKIE_SECURE`/`SESSION_COOKIE_SECURE` and turns any *other* unhandled 500 into a traceback page. Must be `false` before any deployment.
6. **The Django health endpoint is unauthenticated and echoes raw exception strings** including DB host/port/user and the Redis URL (audit W-05). Out of scope here; the same class of leak F-04 closed for enqueue endpoints.
7. **No Django `LOGGING` config** (W-06) and **no DRF throttling** (W-07).
8. **The role claim is still not re-validated** against the database (W-12). Exploiting it requires `AUTH_SECRET`, so it is defence-in-depth, but the F-02 lookup now fetches that row anyway — the check would be nearly free.
9. **Pilot storage divergence** (W-13): compose mounts `app_storage:/storage` while the host stack uses `./storage`.
10. **The secondary-camera physical UAT — 13 tests — is still outstanding.** Unproven across Phases 3G, 3G.1 and the audit.

**Observed and explained, not a defect**

11. `aros-app` logged 20 × `TypeError: Cannot read properties of undefined (reading 'bind')` at startup, from `upgradeHandler`. These were a stale dev-mode browser tab retrying its HMR WebSocket against the production standalone server. Confirmed benign: the count stayed at exactly 20 through 30 s idle **and** through a fresh production page load, while HTTP served normally and 27/27 isolation tests passed against the container.

---

## 9. Production readiness

**Not production-ready, and this remediation does not claim otherwise.**

The complete regression suite passes (221/221) and all four findings are fixed and independently verified. What still stands between this and a production sign-off:

- the **secondary-camera physical UAT** (13 manual tests) has never been completed;
- **`DJANGO_DEBUG=true`**, the unauthenticated health-endpoint leak, missing logging and missing throttling are open;
- the **PostgreSQL-down** and **speech-service-down** resilience scenarios were never exercised;
- the ESLint override should be replaced by renaming the `useDjango*` helpers.

The audit's verdict moves from **NO-GO** to **conditional GO for continued UAT and pilot deployment**, with production sign-off still gated on the items above and on operator sign-off for the physical device tests.

---

*Phase 4C.4 was not started. `prisma/schema.prisma` was not modified. `--accept-data-loss` was never run. No enum value was removed. All five feature flags remain false.*
