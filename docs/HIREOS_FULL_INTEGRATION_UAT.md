# LOGISOFT HIREOS — FULL INTEGRATION / UAT / SECURITY / PARITY AUDIT

**Execution date:** 2026-08-16
**Executed by:** Claude Code (automated audit), against the live local environment
**Scope:** Master UAT brief `Logisoft_HireOS_Master_UAT_Audit.docx`, sections 1–30
**Mode:** Read/test only. No source, Prisma schema, authentication, AI prompt, interview-engine or proctoring-architecture changes were made.
**Phase 4C.4 was not started.**

---

## 1. Executive summary

The **application itself is in good shape**. Every functional area in the brief was exercised against the running system and passed: authentication and RBAC, organization scoping, Jobs/Candidates/Applications reads and parity, resume processing with a verified 768-dimension embedding, AI screening that stays advisory, a **complete TEXT interview**, a **complete VOICE/STT/TTS interview**, live proctoring consent and ingest with rate limiting, post-session recording processing, recruiter playback, all five Django cutover flags independently and combined, and full rollback. 176/176 automated tests pass.

This audit also **closed three items that earlier phases had explicitly recorded as unproven**: the end-to-end TEXT interview, the end-to-end VOICE interview, and ffprobe verification that real secondary-camera recordings contain both video and audio.

**Final recommendation: NO-GO for deployment; GO to continue local UAT on the Next.js + Prisma stack with all flags off.**

Four defects block a deployment sign-off. None of them are in the Django migration work, which performed correctly throughout.

| # | Severity | Finding | Blocks |
|---|---|---|---|
| **F-01** | **BLOCKER** | `aros-app` container cannot start. Its entrypoint runs `prisma db push` against the live database at every boot; the image is older than the schema and Prisma refuses because it would drop 9 in-use `ProctoringSignalType` enum values. | Packaged / pilot deployment |
| **F-02** | **HIGH** | A deactivated user's existing session keeps working on Next.js staff APIs until the 12-hour JWT expires. Django correctly returns 401; Next.js returns 200. | Any shared/multi-user deployment |
| **F-03** | **MEDIUM** | **JOBS-05 (known, reproduced).** Editing a Job through the UI silently clears its Department on every save. | Data integrity |
| **F-04** | **MEDIUM** | With Redis down, the Django enqueue endpoints return an unhandled HTTP 500 with a full Django DEBUG traceback instead of a clean 503. `DJANGO_DEBUG=true` is set. | Operational readiness |

Secondary-camera physical device tests are **MANUAL / BLOCKED** — see §12. They remain the single largest untested surface and were also unproven in Phases 3G and 3G.1.

---

## 2. Environment

### 2.1 Service matrix

| Service | Expected | Observed | Result |
|---|---|---|---|
| Next.js | 3000 | `npm run dev`, `/api/health` 200 | PASS |
| Django | 8000 | `/api/v1/health/` 200 | PASS |
| PostgreSQL | 55432 | PostgreSQL 16.14, `vector` extension 0.8.6 | PASS |
| Redis | 6379 | `hireos-redis`, PONG | PASS |
| Celery | worker | **Not running at audit start**; started for the audit, then `celery@DESKTOP-9177HSA` healthy | WARNING → PASS |
| Speech | 8001 | `{ok:true, whisperModel:"small", voice:"en_US-lessac-medium", piperReady:true}` | PASS |
| Ollama | 11434 | `qwen2.5:7b`, `nomic-embed-text:latest` | PASS |

Health at baseline:
```
{"ok":true,"service":"Logisoft HireOS","selfHosted":true,"aiProvider":"local",
 "database":{"ok":true},"ollama":{"ok":true,"chatModel":"qwen2.5:7b","embedModel":"nomic-embed-text"},
 "speech":{"ok":true,"device":"cpu","whisperModel":"small"},"storage":"./storage","mail":{"mode":"clipboard"}}
```

### 2.2 Environment warnings

| ID | Severity | Observation |
|---|---|---|
| ENV-01 | MEDIUM | **Celery worker was not running at audit start.** `/api/v1/health/` reported `celery.ok=false — no workers responded`. Every Phase 3D–3G background feature is inert in this state, and the failure is only visible on the Django health endpoint. |
| ENV-02 | MEDIUM | **Two Ollama instances contend for port 11434** — Docker `aros-ollama` (has both models) and a host `ollama.exe serve` (PID 11472, has only `nomic-embed-text`). With the container stopped, the host silently took over and chat AI failed with `model 'qwen2.5:7b' not found`. Embeddings would still have worked, so the failure is partial and confusing. Run exactly one. |
| ENV-03 | MEDIUM | **Duplicate Next.js dev-server stacks were found running simultaneously** (6 node processes, two full `next dev` trees). This produced HTTP 500 `missing required error components` on every route until the duplicates were killed and `.next` was cleared. Phase 3D warned about exactly this class of problem for Celery workers; it applies to Next too. |
| ENV-04 | LOW | `NEXT_PUBLIC_APP_NAME` in `.env` is `"AI Recruitment OS"` while `.env.example` and `/api/health` use `"Logisoft HireOS"`. Cosmetic brand drift. |
| ENV-05 | MEDIUM | `.env` line 8 carries the comment *"Cleared for local-only — rotate this key… (treat old value as burned)"* yet a real-looking `OLLAMA_API_KEY` value is still present on line 9. Rotate and empty it. |
| ENV-06 | LOW | Celery worker stdout was not captured to a file in this run, so §14's "logs contain IDs not resume bodies" was verified from the Django unit tests (`test_logs_omit_resume_and_reasoning`) and code inspection rather than live log capture. |

### 2.3 Feature flags at baseline

All five confirmed **false** (`NEXT_PUBLIC_USE_DJANGO_READS` and `..._ASYNC` were absent from `.env`, which the shared parser treats as false):

```
NEXT_PUBLIC_USE_DJANGO_READS=false   NEXT_PUBLIC_USE_DJANGO_ASYNC=false
NEXT_PUBLIC_USE_DJANGO_STAGE_WRITES=false
NEXT_PUBLIC_USE_DJANGO_JOB_WRITES=false
NEXT_PUBLIC_USE_DJANGO_ADMIN_WRITES=false
```

`.env` was backed up before testing and **restored byte-identically** at the end (md5 `0ee1ad3e97ad690a4a4fd79ea9d8925d` before and after).

---

## 3. Test totals

| Category | Total | PASS | FAIL | BLOCKED / MANUAL |
|---|---|---|---|---|
| Automated regression | 176 | 176 | 0 | 0 |
| Authentication / RBAC / isolation | 41 | 40 | 1 | 0 |
| Jobs | 12 | 11 | 1 | 0 |
| Candidates / Applications | 10 | 10 | 0 | 0 |
| Resume processing | 7 | 7 | 0 | 0 |
| AI screening | 9 | 9 | 0 | 0 |
| Interviews — TEXT | 11 | 11 | 0 | 0 |
| VOICE / STT / TTS | 7 | 7 | 0 | 0 |
| Live proctoring | 9 | 9 | 0 | 0 |
| Secondary camera (physical) | 13 | 0 | 0 | 13 |
| Post-session proctoring | 9 | 9 | 0 | 0 |
| Stage + human decisions | 9 | 9 | 0 | 0 |
| Admin / user / dept / org writes | 11 | 11 | 0 | 0 |
| Feature-flag cutover matrix | 8 | 8 | 0 | 0 |
| Failure / resilience | 10 | 8 | 1 | 1 |
| Deployment / packaging | 3 | 0 | 1 | 2 |
| Database integrity | 6 | 6 | 0 | 0 |
| **TOTAL** | **351** | **331** | **4** | **16** |

### 3.1 Automated regression detail

| Suite | Command | Result |
|---|---|---|
| Django | `backend/.venv/Scripts/python.exe manage.py test` | **148 tests OK**, 1.378s |
| Django system check | `manage.py check` | **0 issues** |
| Django migrations | `manage.py showmigrations` | **All unapplied** — confirms Django has never migrated Prisma tables |
| Candidate isolation | `npm run test:isolation` | **22 pass**, 0 fail |
| Secondary-integrity CV | `npm run test:cv` | **6 pass**, 0 fail |

> **Coverage gap (LOW):** five `tests/unit/*.test.ts` files (`staff-reads`, `staff-async`, `staff-stage-writes`, `staff-job-writes`, `staff-admin-writes`, `orb-state`) have no npm script and no CI step. Only `secondary-integrity-cv` is wired up. They pass when run manually but are not protected against regression.

---

## 4. Authentication, RBAC and organization isolation

### 4.1 Authentication

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| AUTH-01 | `POST /api/auth/login` bad password | 401, no session | 401 `{"error":"Invalid email or password"}`, zero cookies set | PASS |
| AUTH-02 | Login as all six roles | 200 + session | All six 200; response contains id/email/name/role/organizationId only | PASS |
| AUTH-03 | Response secret scan | No hash/JWT | No `passwordHash`, no token echoed | PASS |
| AUTH-04 | Cookie attributes | HttpOnly | `aros_session`, HttpOnly, SameSite=Lax, 12h TTL (`secure` only in production — correct for local HTTP) | PASS |
| AUTH-05 | `GET /api/auth/me` unauthenticated | 401 | 401 | PASS |
| AUTH-06 | Django `/api/v1/accounts/me/` via `aros_session` cookie | 200 | 200 | PASS |
| AUTH-07 | Django me via `Authorization: Bearer` | 200 | 200, all six roles | PASS |
| AUTH-08 | Django me, no credentials | 401 | 401 `Authentication credentials were not provided` | PASS |
| AUTH-09 | Django me, tampered signature | 401 | 401 `Invalid token` | PASS |
| AUTH-10 | Django me, expired token | 401 | 401 `Token expired` | PASS |
| AUTH-11 | Django, **inactive user** | 401 | 401 `Authentication required` | PASS |
| **AUTH-12** | **Next.js, inactive user** | **401** | **200 with full data** | **FAIL — see F-02** |
| AUTH-13 | Role normalisation | Documented map | `SUPER_ADMIN→ADMIN`, `HR_ADMIN→HR`, others 1:1 — matches Phase 2 | PASS |

### 4.2 F-02 — Deactivated user retains staff API access (HIGH)

Minted the exact token a real login would have produced for `temp-deact-1786508350082@local.dev` (`isActive = false` in the database) and replayed it:

| Endpoint | Next.js | Django |
|---|---|---|
| `/api/auth/me` | **401** | — |
| `/api/jobs` | **200** | 401 |
| `/api/candidates` | **200** | 401 |
| `/api/applications` | **200** | 401 |
| `/api/analytics` | **200** | 401 |

Fresh login for that user is correctly refused (401). The gap is only for a **session issued before deactivation**.

**Root cause.** `requireUser` / `requireRoles` / `requireStaff` in [src/lib/auth/rbac.ts:14](../src/lib/auth/rbac.ts#L14) trust the JWT claims and never re-check the database. Only `GET /api/auth/me` reads `isActive`, which is why that one endpoint correctly returns 401 while every other staff route does not. Django does the opposite and re-queries the `User` row on every request (`HIREOS_ENFORCE_PRISMA_USER_STATUS`, default true).

**Impact.** Deactivating a user in the admin console does not end their access. A dismissed employee keeps reading candidates, applications and analytics for up to `AUTH_TOKEN_TTL_HOURS` (12h). There is no session-revocation mechanism, and Phase 4C.3 already documents that role changes do not rewrite the JWT — this is the same weakness with a worse consequence.

**Not fixed** (audit is read-only). Reported for decision.

### 4.3 RBAC matrix — Next.js (all flags off)

`200` = allowed, `403` = denied.

| Endpoint | SUPER_ADMIN | HR_ADMIN | RECRUITER | HIRING_MGR | INTERVIEWER | CANDIDATE |
|---|---|---|---|---|---|---|
| `/api/jobs` | 200 | 200 | 200 | 200 | 200 | **403** |
| `/api/candidates` | 200 | 200 | 200 | 200 | 200 | **403** |
| `/api/applications` | 200 | 200 | 200 | 200 | 200 | **403** |
| `/api/applications/board` | 200 | 200 | 200 | 200 | 200 | **403** |
| `/api/analytics` | 200 | 200 | 200 | 200 | **403** | **403** |
| `/api/admin/users` | 200 | 200 | **403** | **403** | **403** | **403** |
| `/api/admin/departments` | 200 | 200 | **403** | **403** | **403** | **403** |
| `/api/admin/org` | 200 | 200 | **403** | **403** | **403** | **403** |

Result: **PASS**. CANDIDATE is denied every staff API. Admin surface is SUPER_ADMIN + HR_ADMIN only. INTERVIEWER correctly excluded from analytics.

`/api/interviews` returns 404 for all roles — there is no collection route, only `/api/interviews/[id]`. Not a defect.

### 4.4 RBAC matrix — Django

| Endpoint | ADMIN | RECRUITER | INTERVIEWER | CANDIDATE |
|---|---|---|---|---|
| `/api/v1/jobs/` | 200 | 200 | 200 | **403** |
| `/api/v1/candidates/` | 200 | 200 | 200 | **403** |
| `/api/v1/applications/` | 200 | 200 | 200 | **403** |
| `/api/v1/applications/{id}/stage/` | 200 | 200 | **403** | **403** |
| `/api/v1/proctoring/process/` | 200 | 200 | **403** | **403** |

Result: **PASS**.

### 4.5 Cross-organization isolation

The database contains **one organization**, so isolation was proven by minting a locally-signed token carrying a non-existent `organizationId` — a stronger test than a second-org fixture because it verifies scoping rather than row filtering.

| ID | Test | Result |
|---|---|---|
| ISO-01 | Foreign-org token → Django jobs/candidates/applications | `count: 0` on all three — **PASS** |
| ISO-02 | Foreign-org token → Next.js `/api/jobs` | `{"jobs":[]}` — **PASS** |
| ISO-03 | Cross-org detail via Django | 404, no existence leak (Django unit tests) — **PASS** |
| ISO-04 | Cross-org stage write | 404 `Application not found` — **PASS** |
| ISO-05 | Cross-org department on job PATCH | 400 `Department not found in organization` — **PASS** |
| ISO-06 | Candidate IDOR (`GET /api/candidates/{otherCandidate}`) | 403, not 404-masking — **PASS** (isolation suite) |

> **Limitation:** with a single organization in the dataset, isolation is verified by scoping behaviour and by the Django unit suite, not by two populated tenants. A two-tenant fixture would strengthen this.

### 4.6 Security observation — role claim is not re-validated (MEDIUM, defence-in-depth)

A token whose `role` claim says `RECRUITER` but whose `sub` is a CANDIDATE user is accepted by **both** stacks — neither re-reads the role from the database (Django re-reads `isActive` but uses the JWT's role). Forging one requires `AUTH_SECRET`, so this is **not** exploitable by a candidate and is not counted as a failure. It is recorded because Django already performs the database lookup that would make the role check nearly free.

### 4.7 Other security checks

| ID | Test | Result |
|---|---|---|
| SEC-01 | `embedding` / pgvector exposed anywhere | **Never** — absent from the Django model definition itself, not merely the serializer. PASS |
| SEC-02 | `passwordHash` exposed | **Never** — not declared on `HireOSUser`, not selected by the directory query, absent from admin responses. PASS |
| SEC-03 | Temporary password | Returned exactly once on user create; never re-readable, never logged. PASS |
| SEC-04 | Proctoring data in AI prompts | Full-text scan of all `AIEvaluation.reasoning`: one regex hit, manually confirmed a **false positive** ("inter**face**s"). No proctoring content in any prompt or evaluation. PASS |
| SEC-05 | AI reasoning in status endpoints | `screening/status/` returns only id/kind/recommendation/overall/model. PASS |
| SEC-06 | Pair tokens in report JSON | Reduced to boolean `pair_token_present`. PASS |
| SEC-07 | Recording served from public path | No; authenticated route only, byte-range streamed. PASS |
| SEC-08 | SQL injection surface | All raw SQL parameterised; the one interpolated value is the pgvector literal built from `float()`-coerced numbers. PASS |
| **SEC-09** | Django `DEBUG` | **`DJANGO_DEBUG=true`** — disables secure-cookie flags and turns 500s into full tracebacks. See F-04. **WARNING** |
| SEC-10 | Django health endpoint | Unauthenticated and echoes raw exception strings containing DB host/port/user and Redis URL. **WARNING** |
| SEC-11 | Django logging | No `LOGGING` config; four named `hireos.*` loggers have no handlers. Auth failures are not durably recorded. **WARNING** |
| SEC-12 | DRF throttling | None on any endpoint, including enqueue POSTs that spawn Node subprocesses and Ollama calls. **WARNING** |

---

## 5. Jobs

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| JOBS-01 | List / detail parity Next vs Django | Identical | 6 jobs, identical IDs, titles, status, departmentId, application counts | PASS |
| JOBS-02 | Create synthetic TEST Job | 201 | 201, `cmsvhfr100001zy1dnsabnonm`, dept + status + experience correct | PASS |
| JOBS-03 | Edit title (API, `departmentId` omitted) | Persist, dept kept | Title saved, dept retained | PASS |
| JOBS-04 | Edit skills / experience / criteria / status | Persist | `PAUSED`, expMax 6, 7 skills, criteria saved; dept retained | PASS |
| **JOBS-05** | **Edit Job through the UI** | **Dept preserved** | **Department silently cleared** | **FAIL — see below** |
| JOBS-06 | `PATCH departmentId: null` explicitly | Clears dept | Cleared — correct for a nullable field | PASS |
| JOBS-07 | Status transitions | Accepted | DRAFT/OPEN/PAUSED/CLOSED all accepted (no DAG, by design) | PASS |
| JOBS-08 | Application counts / relationships | Accurate | Counts match Prisma exactly | PASS |
| JOBS-09 | Delete TEST Job | Disappears | 200 `{ok:true}`, row gone, no collateral | PASS |
| JOBS-10 | HIRING_MANAGER create | 403 | 403 `Insufficient permissions` (`canManageJobs`) | PASS |
| JOBS-11 | JOB_WRITES on → Django | Django serves | 201/200/200, Django-style ID `ccbbe26af5844f2f8df47c81d` | PASS |
| JOBS-12 | JOB_WRITES on + Django down | 503, no fallback | 503, nothing persisted | PASS |

### 5.1 F-03 / JOBS-05 — Department cleared on every UI Job edit (MEDIUM)

**Confirmed at runtime, twice.** Operator flagged this as the one known failure; it reproduces exactly and the cause is now identified.

Runtime probe of the live edit form for a job whose department is Engineering:

```
deptSelectExists:  true
deptSelectOptions: ["" : "—",
                    "cmsp3apq400022ezwtoop8hor" : "Engineering",
                    "cmsp3apqb00042ezweqkppys7" : "People"]
deptSelectValue:   ""          <-- should be the Engineering id
```

End-to-end save changing only the title:

```
before_departmentName : "Engineering"
deptSelectValueAtSubmit: ""
after_departmentId     : null
after_title            : "TEST Senior Full Stack Engineer UAT2 uiedit"   (title saved correctly)
```

**Root cause.** In [src/components/job-form.tsx](../src/components/job-form.tsx):

- Line 28 — `departments` starts as `[]`.
- Lines 31–38 — the list is fetched asynchronously in `useEffect` from `/api/org`.
- Line 104 — the `<select>` is **uncontrolled** with `defaultValue={initial?.departmentId ?? ""}`.

React applies `defaultValue` only on the **first** render, when `departments` is still empty and the matching `<option>` does not exist, so the select falls back to the `—` placeholder. When the options arrive on a later render, React does not re-apply `defaultValue`. The select stays empty.

- Line 60 — the form then submits `departmentId: String(form.get("departmentId") || "") || null`, i.e. **`null`**.
- The API is behaving correctly: `departmentId` is `z.string().nullable().optional()`, so an explicit `null` legitimately clears the field.

So this is purely a client-side defect, and it fires on **every** Job edit regardless of which field the user meant to change. It is not caught by the API tests because the API only clears the department when explicitly told to.

**Not fixed**, per instruction.

---

## 6. Candidates and Applications

| ID | Test | Result |
|---|---|---|
| CAND-01 | Candidate list parity | 19 vs 19, identical ID sets — PASS |
| CAND-02 | `embedding` never exposed | Absent from both stacks — PASS |
| CAND-03 | Staff-visible profile fields | firstName/lastName/email/phone/location/skills/experience/education/certifications — PASS |
| APP-01 | Application list parity | 21 vs 21, identical ID sets — PASS |
| APP-02 | Pipeline counts parity | APPLIED 9, SCREENING 0, SHORTLISTED 0, ASSESSMENT 1, AI_INTERVIEW 2, TECH_INTERVIEW 1, HR_INTERVIEW 1, SELECTED 1, REJECTED 6 — identical, and matches Phase 4A exactly — PASS |
| APP-03 | Compact nested summaries | Django nests only `candidate{id,firstName,lastName,email,experience,skills}` and `job{id,title,status,department{name}}` — PASS |
| APP-04 | No AI reasoning / notes / proctoring in Django reads | Confirmed; `aiEvaluations` deliberately omitted — PASS |
| APP-05 | CANDIDATE blocked from staff APIs | 403 on all — PASS |
| APP-06 | No unintended application changes after Job ops | Counts and stages unchanged — PASS |
| APP-07 | Board endpoint | 200, always Prisma (never switched) — PASS |

### 6.1 Parity deltas (expected, documented — not failures)

| Delta | Detail |
|---|---|
| `aiEvaluations` | Next.js list includes it; Django omits it. Deliberate per Phase 4A; the adapter "does not invent" them. Consumers relying on list-level AI data must not depend on it when READS is on. |
| Pagination | Next lists are unpaginated; Django paginates (25 default, 100 max). The BFF fetches all pages. |
| Cross-org detail | Next 403 vs Django 404. Documented, intentional (no existence leak). |
| SUPER_ADMIN scope | Next `orgScopeWhere` allows global; Django is JWT-org-strict. Django is **stricter** — correctly not widened. |
| Timeline IDs | Django-created events use `c` + 24 hex, not Prisma `cuid()`. |
| Same-stage write | Next creates a duplicate timeline event; Django is a no-op. Verified: 13 → 14 events across a move plus a same-stage repeat. |

### 6.2 `resumeText` on list endpoints (WARNING)

`resumeText` — the full raw resume body — is returned on the **paginated candidate list** by both stacks, reachable by `StaffOnly`, which **includes INTERVIEWER**. This is pre-existing behaviour and is parity-consistent, so it is not scored as a failure. It is worth noting that the applications queryset explicitly defers this same field (`apps/applications/querysets.py:26`), so the two paths disagree about whether raw resume text belongs in a list response. Phase 3B already recorded this as a known limitation.

---

## 7. Resume processing

Target: retained TEST candidate `taylor.testcase@example.com` / `cmspldr28000ijqyl4znuq8su`.

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| RES-01 | Enqueue returns fast | Fast, task id | `{"status":"queued","task_id":"4f6d29a7-…"}` | PASS |
| RES-02 | Duplicate enqueue shares lock | Same task id | `already_processing`, **same task_id**, 173 ms | PASS |
| RES-03 | Redis NX lock present | Lock key | `hireos:resume:lock:cmspldr28000ijqyl4znuq8su` + status key | PASS |
| RES-04 | Task IDs only, never paths | IDs only | Payload is `{candidate_id}` only | PASS |
| RES-05 | Parser output matches `Candidate.resumeText` | Match | 254 chars — identical to Phase 3D | PASS |
| RES-06 | **Embedding is exactly 768 dimensions** | 768 | `vector_dims(embedding) = 768` | **PASS** |
| RES-07 | Completion status | completed | `{"status":"completed","resume_text_length":254,"embedding_dims":768}` | PASS |

---

## 8. AI screening

Target: retained TEST application `cmspldr2c000kjqylx1y8gg4v`.

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| SCR-01 | Fast enqueue + task id | Fast | `queued`, **152 ms** | PASS |
| SCR-02 | Duplicate click shares task | Same id | `already_processing`, same id, **127 ms** | PASS |
| SCR-03 | Redis lock | Present | `screening:application:cmspldr2c000kjqylx1y8gg4v` | PASS |
| SCR-04 | Existing TypeScript engine used | `screenApplication` via Node CLI | Confirmed — no Python reimplementation | PASS |
| SCR-05 | Ollama result → AIEvaluation | Created | `cmsvhm9rc000111nurtadpf2x`, kind `RESUME_SCREEN` | PASS |
| SCR-06 | Recommendation / score / reasoning | Present | **YES / 85 / qwen2.5:7b**, reasoning 270 chars — matches Phase 3E (YES/85) | PASS |
| SCR-07 | Timeline `advisoryOnly` | true | `SCREENING_COMPLETED`, `advisoryOnly=true`, `recommendation=YES`, `overall=85` | PASS |
| **SCR-08** | **Stage/status must NOT change** | Unchanged | **`APPLIED / ACTIVE` before and after** | **PASS** |
| SCR-09 | Proctoring signals absent from prompts | Absent | Verified by scan + Django code-scan tests | PASS |

Worker time: **96 s** (Ollama-bound, consistent with Phase 3E's ~89.6 s). Django does not make Ollama faster and this audit makes no such claim.

---

## 9. Interviews — complete TEXT path

> This closes Phase 3F blocked item **B2** ("full TEXT interview — NOT run").

Session `cmsvhq66o0003zy1dw8999h48`, TEXT, 3 questions, 30 min, proctoring STANDARD.

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| INT-01 | Create interview + plan | Plan generated | 201; plan by `qwen2.5:7b`, 4 topics, **100 s** synchronous | PASS |
| INT-02 | Magic link + token | Issued | 64-hex token, `tokenExpiresAt` +1 day | PASS |
| INT-03 | Room info leaks nothing | No scores/plan | Only status/mode/counters/jobTitle/firstName | PASS |
| INT-04 | Start | Q1 + `endsAt` | 200 in **1190 ms**, `endsAt` = start + 30 min | PASS |
| INT-05 | Answer → next question ×3 | Adaptive | **446 / 684 / 743 ms** | PASS |
| INT-06 | Adaptive logic stays on Next.js, no Celery wait | Sub-second | Confirmed — no Ollama in the live loop | PASS |
| INT-07 | Conclusion | `concluded: true` | Correct after Q3 | PASS |
| INT-08 | Candidate never sees scores | No score keys | Zero score/evaluation keys in every response | PASS |
| INT-09 | Transcript persisted | 3 Q + 3 A | 3 questions, 3 answers, all with background evaluations | PASS |
| INT-10 | Background scoring | Scored | Per-answer JSON: `score, competency, strengths, weaknesses, redFlags, reasoning` | PASS |
| INT-11 | Malformed body rejected | 400 | 400, nothing persisted | PASS |

### 9.1 Finalize (advisory evaluation)

| ID | Test | Actual | Result |
|---|---|---|---|
| FIN-01 | Plan on a COMPLETED session | 400 `session_not_scheduled` | PASS |
| FIN-02 | Finalize enqueue | `queued`, **401 ms**; duplicate shares task id | PASS |
| FIN-03 | Worker completes | **210 s** (Phase 3F recorded 205.84 s) | PASS |
| FIN-04 | `INTERVIEW_OVERALL` created | `cmsvhwzfp0001rsewnlrda8r3`, recommendation YES, `qwen2.5:7b` | PASS |
| FIN-05 | Session stays COMPLETED | COMPLETED | PASS |
| **FIN-06** | **Application stage unchanged** | **`APPLIED / ACTIVE`** | **PASS** |

> **Observation (LOW):** the finalize status endpoint reported `QUEUED` for the entire 210 s run and never `PROCESSING`, whereas screening correctly reported `PROCESSING`. A recruiter watching the UI sees "queued" for three and a half minutes while work is happening. Cosmetic but misleading.

---

## 10. VOICE / STT / TTS

> This closes Phase 3F blocked item **B2** ("full VOICE interview — NOT run").

Session `cmsvi0j1t000szy1d2tr7qtha`, VOICE + proctoring ENHANCED + integrity STRICT.

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| VOI-01 | STRICT start without integrity consent | 403 | 403 `Please acknowledge interview integrity requirements first` | PASS |
| VOI-02 | Integrity consent then start | 200 | 200, Q1 returned | PASS |
| VOI-03 | ENHANCED consent requires recording consent | Rejected without it | 400 `Enhanced recording consent is required…`; 200 with `recordingConsent: true` | PASS |
| VOI-04 | **STT transcript** | Accurate | Whisper small returned an accurate transcript (minor expected slips: "readies"/"redis", "get commit"/"git commit") | PASS |
| VOI-05 | Answer processed → next question | Advances | Round trip **8359 ms** including STT | PASS |
| VOI-06 | TTS generation and cache | Cached | Cold **3336 ms** → warm **609 ms**; `q1.wav`/`q2.wav`/`q3.wav` on disk | PASS |
| VOI-07 | Interview completes in VOICE mode | COMPLETED | Session `COMPLETED`, `deliveryMode = VOICE` | PASS |

**Speech-down behaviour:** the code path returns 503 `{speechDown:true}` and TEXT remains fully usable (TEXT was exercised independently with the speech service both up and irrelevant to that path). A deliberate speech-service outage was **not** run — see §16 BLOCKED items.

---

## 11. Live proctoring

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| PRO-01 | Signals rejected before consent | 403 | 403 `Proctoring consent required before signals are accepted` | PASS |
| PRO-02 | Pairing rejected before consent | Rejected | 400 `Proctoring consent is required first` | PASS |
| PRO-03 | Consent recorded explicitly | Stored | `{consentedAt, cameraConsent:true, recordingConsent:true}` | PASS |
| PRO-04 | Signal ingest after consent | Stored | `{"ok":true,"stored":5,"capped":false}` | PASS |
| PRO-05 | Signal types validated | Enum enforced | Invalid types → 400 listing the 11 valid values | PASS |
| PRO-06 | **Rate limit 20 batches/min** | Cut off at 20 | **19 accepted, then 429 from the 20th onward** | PASS |
| PRO-07 | Events persisted | In DB | TAB_BLUR, NO_FACE, MULTIPLE_FACES, LOOKING_AWAY, COPY_PASTE — 1 each | PASS |
| **PRO-08** | **Signals never change stage or AI score** | Unchanged | `APPLIED / ACTIVE` throughout | **PASS** |
| PRO-09 | Secondary pairing mint | Token + LAN URL | `pairToken`, `https://192.168.1.8:3443/interview/secondary/…`, `reachableFromPhone:true`, `requiresHttpsTrust:true`, 15-min expiry | PASS |

---

## 12. Secondary-camera physical UAT — **MANUAL / BLOCKED**

These require a real phone on the same LAN. This audit has **no connected physical device** and therefore **claims no result**. Phases 3G and 3G.1 also left these unproven ("needs a designated test device. Do not treat 3G.1 as a substitute").

The **server side** of the pairing flow was verified as far as software allows: token minting, LAN HTTPS URL generation, consent gating, heartbeat/frame/integrity endpoint existence, and the recording chunk/ACK contract in code and unit tests.

| ID | Manual test | Status |
|---|---|---|
| SEC-M-01 | Laptop starts TEST interview and pairing flow | **MANUAL** |
| SEC-M-02 | Phone pairs over the required LAN/origin | **MANUAL** |
| SEC-M-03 | Phone heartbeat and live preview | **MANUAL** |
| SEC-M-04 | Candidate stands / moves away → expected signals | **MANUAL** |
| SEC-M-05 | Second device beside laptop → device/attention signals | **MANUAL** |
| SEC-M-06 | Another person enters frame → MULTIPLE_FACES / extra-person | **MANUAL** |
| SEC-M-07 | Disconnect / reconnect phone → recovery | **MANUAL** |
| SEC-M-08 | Complete interview → chunks present on disk | **MANUAL** |
| SEC-M-09 | Terminal session triggers Celery post-session processing | **MANUAL** (server side verified separately — §13) |
| SEC-M-10 | Assembled recording exists, non-empty, SAVED only after verification | **MANUAL** (rule verified on historical data — §13) |
| SEC-M-11 | `manage.py proctoring_artifacts` | **PASS** — run, see §13 |
| SEC-M-12 | Recruiter playback contains video + audio | **PASS** — verified on real recordings, see §13 |
| SEC-M-13 | Phone orientation | **MANUAL — no claim.** Recordings carry no rotate tag and `orientation_corrected` is always `false`; review-side CSS rotation is not verified without a device. |

---

## 13. Post-session proctoring and recording integrity

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| PSP-01 | IN_PROGRESS session rejected | 400 | 400 `session_not_terminal` | PASS |
| PSP-02 | COMPLETED session accepted | 200 | `queued`, **155 ms** | PASS |
| PSP-03 | CANDIDATE role | 403 | 403 `Insufficient permissions` | PASS |
| PSP-04 | Report packaged post-session | Artifact | `proctoring-report.json` written | PASS |
| PSP-05 | Report labelled correctly | Advisory | `advisory_only:true`, `not_a_cheating_verdict:true`, `not_ai_input:true` | PASS |
| PSP-06 | Report leaks no secrets | Safe | No tokens/paths/emails; `pair_token_present` is a boolean | PASS |
| PSP-07 | Missing recording not faked | Honest | `outcome: "no_recording"`, `recording_present: false` — did not claim completeness | PASS |
| PSP-08 | **Stage unchanged** | Unchanged | `APPLIED / ACTIVE` | PASS |
| PSP-09 | `manage.py proctoring_artifacts` | All verified | `storage_root=…\AI Interview\storage` → **checked=6 ok=6 missing=0** | PASS |

### 13.1 Real recording verification — closes Phase 3G blocked item B7

Earlier phases only ever probed a **synthetic 1-second clip**. Four real secondary-camera recordings were probed:

| Session | Size | Streams | Resolution | Duration |
|---|---|---|---|---|
| `cmssobsoq00019t0yz8ojjubl` | 91 MB | **h264 video + aac audio** | 1280×720 | 146.8 s |
| `cmssozthp001q9t0yplrzaygg` | 226 MB | **h264 video + aac audio** | 1280×720 | 441.1 s |
| `cmssuxuyk000vjfxpxspi3ob5` | 124 MB | **h264 video + aac audio** | 1280×720 | 161.6 s |
| `cmssx4xka0005l1djxr6q5s5w` | 32 MB | **h264 video + aac audio** | 1920×1080 | 88.9 s |

Every one contains **both video and audio**. The 3G.1 integrity rule (SAVED only after the file is verified on disk) holds across all 6 SAVED rows.

### 13.2 Recruiter playback

| ID | Test | Actual | Result |
|---|---|---|---|
| PLB-01 | Recruiter range request | **HTTP 206**, `content-range: bytes 0-2047/129726995`, `content-type: video/mp4`, `accept-ranges: bytes` | PASS |
| PLB-02 | Unauthenticated | 401 | PASS |
| PLB-03 | CANDIDATE | 403 | PASS |
| PLB-04 | INTERVIEWER (no pipeline permission) | 403 | PASS |
| PLB-05 | Metadata endpoint | `{status:"SAVED", hasRecording:true, durationMs:191770, reviewOnly:true, noAiInput:true}` | PASS |

---

## 14. Stage and human decision writes (Phase 4C.1)

Flag `NEXT_PUBLIC_USE_DJANGO_STAGE_WRITES=true`, TEST application only.

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| STG-01 | Advance to SCREENING | 200 | 200, **1075 ms** | PASS |
| STG-02 | SELECTED without note | 400 | 400 `Final decisions require a human rationale (note)` | PASS |
| STG-03 | SELECTED with 2-char note | 400 | 400 (enforces ≥5 chars) | PASS |
| STG-04 | **SELECTED with rationale → HIRED** | HIRED | `stage=SELECTED status=HIRED` | PASS |
| STG-05 | **REJECTED with rationale → REJECTED** | REJECTED | `stage=REJECTED status=REJECTED` | PASS |
| STG-06 | `advisoryNote` returned | Present | *"AI recommendations are advisory only. This stage change was made by a human."* | PASS |
| STG-07 | `STAGE_CHANGED` with `humanDecision=true` | Present | All events show `humanDecision: true` with from/to/note | PASS |
| STG-08 | Same-stage repeat creates no duplicate | No-op | Timeline 13 → 14 across a real move **plus** a same-stage repeat | PASS |
| STG-09 | INTERVIEWER → 403, missing → 404 | Correct | 403 and 404 `Application not found` | PASS |
| STG-10 | Rollback to Next.js | Prisma path | Flag off → write succeeds via Prisma | PASS |

**Extra-field handling (parity note, not a failure).** Sending `organizationId` through the BFF returns 200 because the Next.js Zod schema **strips** unknown keys before forwarding. Called **directly**, Django correctly returns `400 {"error":"Unsupported fields"}`. The security property holds either way — the organization was never honoured and remained `cmsp3appz00002ezwf1xu0oiu`.

---

## 15. Admin / user / department / organization writes (Phase 4C.3)

Flag `NEXT_PUBLIC_USE_DJANGO_ADMIN_WRITES=true`, TEST users only.

| ID | Test | Expected | Actual | Result |
|---|---|---|---|---|
| ADM-01 | Create staff user | 201 | 201, id `c6aa265faf1ef2f327a7685cc` | PASS |
| ADM-02 | Temporary password returned once | Yes | Present in response | PASS |
| ADM-03 | **`passwordHash` never returned** | Absent | Absent from the full response body | PASS |
| ADM-04 | Duplicate email | 409 | 409 `Email already in use` | PASS |
| ADM-05 | Deactivate then activate | Both 200 | 200 / `isActive=false` → 200 | PASS |
| ADM-06 | Role change by HR_ADMIN | 403 | 403 `Only Super Admin can change roles` | PASS |
| ADM-07 | Role change by SUPER_ADMIN | 200 | 200, DB role `INTERVIEWER` | PASS |
| ADM-08 | Role change does not rewrite JWT | Re-login required | Confirmed by code + Phase 4C.3; DB updates immediately | PASS (documented behaviour) |
| ADM-09 | Department create / rename / delete | All work | 201 → 200 rename → 200 `{ok:true}` delete | PASS |
| ADM-10 | Delete department in use | 400 | 400 `Department still has users or jobs — reassign first` | PASS |
| ADM-11 | Organization patch | 200 | 200; name `Logi Hiring`, slug unchanged | PASS |
| ADM-12 | RECRUITER on admin write | 403 | 403 `Insufficient permissions` | PASS |

Non-existent features were **not** tested and **not** invented: no password reset, no user deletion, no organization create/delete, no org move.

---

## 16. Cutover matrix and rollback

| Mode | Verification | Result |
|---|---|---|
| **All flags OFF** | Baseline Next.js/Prisma behaviour across all areas | PASS |
| **READS only** | Jobs/Candidates/Applications/pipeline-counts served by Django; parity exact; `/dashboard/jobs` RSC 200; CANDIDATE still 403 | PASS |
| **ASYNC only** | Screen enqueue `queued` + task id; duplicate shares id; status polls for resume/screening/finalize | PASS |
| **STAGE_WRITES only** | Full §14 suite | PASS |
| **JOB_WRITES only** | Create/edit/status/delete via Django; HM 403 | PASS |
| **ADMIN_WRITES only** | Full §15 suite | PASS |
| **All approved flags ON** | Combined workflow: reads + job CRUD + admin writes + stage writes + async enqueue, all correct together | PASS |
| **All flags OFF again** | Reads back on Prisma; stage write back on Prisma; async endpoints return `{"status":"IDLE"}`; TTS prefetch `400 Async TTS prefetch is disabled` | PASS |

Rollback is exactly as documented: set the flag false, restart Next.js, traffic returns to Prisma, no data change.

### 16.1 Failure / resilience

| ID | Dependency | Expected | Actual | Result |
|---|---|---|---|---|
| RES-01 | Django unreachable + STAGE_WRITES on | 503, no silent fallback | **503 `Staff action service unavailable`; DB unchanged (`APPLIED/ACTIVE`)** | PASS |
| RES-02 | Django unreachable + READS on | 503 | 503 `Staff read service unavailable` on all four read routes | PASS |
| RES-03 | Django unreachable + JOB_WRITES on | 503 | 503 on POST and PATCH; job count and title unchanged | PASS |
| RES-04 | Django unreachable + ADMIN_WRITES on | 503 | 503 on department create and org patch; department count unchanged | PASS |
| RES-05 | Django unreachable + ASYNC on | 503 | 503 `Staff action service unavailable` | PASS |
| RES-06 | Django down, flags OFF | Next.js unaffected | All Prisma routes 200 | PASS |
| RES-07 | Redis down → live interview independent | Must continue | Interview room 200; all Next.js routes 200 | PASS |
| RES-08 | Redis down → Django reads | Still work | `/api/v1/jobs/` 200 | PASS |
| **RES-09** | **Redis down → Celery enqueue** | Clean, visible failure | **Unhandled HTTP 500 with a full Django DEBUG traceback page** | **FAIL — F-04** |
| RES-10 | Ollama unavailable → graceful | No fake score | **503 `{"code":"OLLAMA_HTTP","ollamaDown":true}`, no AIEvaluation created** | PASS |
| RES-11 | Speech service down | TEXT usable, VOICE reports failure | **NOT RUN** | BLOCKED |
| RES-12 | PostgreSQL down | Explicit unavailable, no partial writes | **NOT RUN** — would disrupt the shared database | BLOCKED |

### 16.2 F-04 — Redis-down enqueue returns a DEBUG traceback (MEDIUM)

With Redis stopped, `POST /api/v1/screening/` returned:

```
HTTP 500
<!DOCTYPE html> … <title>ConnectionError at /api/v1/screening/</title> …
```

The failure **is** visible rather than silent, which satisfies the architectural requirement. Two problems remain:

1. It is an **unhandled exception**, not the documented clean JSON 503. Through the BFF a recruiter receives an HTML 500.
2. `DJANGO_DEBUG=true` (`backend/.env:2`) means the response is a **full Django traceback page** exposing settings, file paths and configuration. Harmless locally; serious if DEBUG ever reaches a deployed environment. The same setting also disables `CSRF_COOKIE_SECURE` and `SESSION_COOKIE_SECURE`.

Django health reports the condition correctly (`redis:false`, `celery:false`) and Redis/Celery recovered cleanly on restart.

---

## 17. F-01 — Packaged deployment is broken (BLOCKER)

Mid-audit the operator brought up the Docker Compose pilot stack. `aros-app` **never became healthy** and looped on:

```
⚠️  There might be data loss when applying the changes:
  • The values [SECONDARY_PERSON_MOVED, SECONDARY_PERSON_RETURNED, SECONDARY_ATTENTION_DEVIATION,
     SECONDARY_DEVICE_VISIBLE, SECONDARY_DEVICE_REMOVED, SECONDARY_DEVICE_INTERACTION,
     SECONDARY_MULTIPLE_PERSONS, SECONDARY_PERSON_RETURNED_TO_ONE, SECONDARY_PERSON_INTERACTION]
     on the enum `ProctoringSignalType` will be removed.
Error: Use the --accept-data-loss flag to ignore the data loss warnings
[app] database not ready, retry 10/30…
```

**Facts established:**

1. [docker/app/entrypoint.sh:10](../docker/app/entrypoint.sh#L10) runs `prisma db push --skip-generate` in a retry loop **against the live database on every container start**.
2. The built image predates the secondary-camera integrity work (commits `f4fae26` / `59dbfac`). Its schema has 6 `SECONDARY_*` enum values; the working tree at [prisma/schema.prisma:138](../prisma/schema.prisma#L138) has **15**; the live database has all 15 (26 enum values total).
3. `ProctoringEvent` rows actively use `SECONDARY_CAMERA_CONNECTED` (240), `SECONDARY_NO_FACE` (9), `SECONDARY_LOOKING_AT_DEVICE` (3), `SECONDARY_CAMERA_DISCONNECTED` (2).
4. Prisma's safety check is currently **the only thing** preventing the drop.

**Why this is a blocker, not just a stale image.** The error message advertises `--accept-data-loss` as the fix. Applying it would drop 9 enum values that the **current application code still emits**, breaking secondary-camera integrity signal writes at runtime. And regardless of the drift, an automatic schema mutation in a container start path conflicts directly with the brief's rule that PostgreSQL is the source of truth.

**Action taken: none.** `--accept-data-loss` was not run. The database was verified untouched afterwards (26 enum values, 359 `ProctoringEvent` rows). Per STOP condition §29, this is reported rather than fixed.

**Recommended remediation (for the operator, not applied here):** rebuild the image from the current tree so the startup `db push` becomes a no-op, and separately reconsider whether a schema-mutating command belongs in a container entrypoint at all.

> Related packaging note: compose mounts `app_storage:/storage` (a Docker volume) while the host stack uses `./storage`. Recordings written under the pilot would land somewhere different from the dev stack — the same class of `STORAGE_ROOT` divergence that caused the Phase 3G false-`incomplete` failure. Phase 3H's recommendation to set an **absolute** `STORAGE_ROOT` still stands.

---

## 18. Performance

Measured on the **development server** (`next dev`). These include dev-mode compilation and are not production figures. First-request outliers are route compilation.

### 18.1 Staff reads, n = 10 each

| Read | Flags OFF (Prisma) P50 | P95 | Flags ON (Django BFF) P50 | P95 |
|---|---|---|---|---|
| Jobs | **230 ms** | 241 ms | **315 ms** | 776 ms |
| Candidates | **225 ms** | 248 ms | **298 ms** | 691 ms |
| Applications | **230 ms** | 242 ms | **299 ms** | 546 ms |
| Pipeline counts | — | — | **291 ms** | 503 ms |

The Django path costs roughly **+70 ms P50** — the extra same-origin BFF hop. Both are well within interactive budgets.

### 18.2 Enqueue latency (HTTP only)

| Operation | First | Duplicate | Notes |
|---|---|---|---|
| `POST /api/v1/resumes/process/` | — | **173 ms** | same task id |
| `POST /api/v1/screening/` | **152 ms** | **127 ms** | same task id |
| `POST /api/v1/interviews/finalize/` | **401 ms** | fast | same task id |
| `POST /api/v1/proctoring/process/` | **155 ms** | — | |
| Screening via Next BFF | 1022 ms (incl. compile) | **375 ms** | |

### 18.3 Worker / model time (separate from enqueue)

| Task | Time | Phase baseline |
|---|---|---|
| `files.process_resume` | < 3 s | 1.78 s |
| `screening.screen_application` | **96 s** | ~89.6 s |
| `interviews.generate_plan` (synchronous, in-request) | **100 s** | 131 s |
| `interviews.finalize_interview` | **210 s** | 205.8 s |
| `proctoring.process_session` | < 8 s | 50–237 ms |

All heavy time is **Ollama on CPU**. Django and Celery move the wait off the request thread; they do not make the model faster, and no such claim is made.

### 18.4 Live interview latency (measured separately, as required)

| Operation | Latency |
|---|---|
| TEXT start (first question) | **1190 ms** |
| TEXT next question (n=3) | **446 / 684 / 743 ms** — P50 684 ms |
| VOICE answer (upload → Whisper STT → next question) | **8359 ms** |
| TTS cold synthesis | **3336 ms** |
| TTS warm (cache hit) | **609 ms** |

The live TEXT loop stays under a second because `decideNextTurn` is deterministic and never calls Ollama — the architectural boundary holds in practice.

---

## 19. Database integrity

### 19.1 Row counts, pre vs post

| Table | Pre | Post | Δ | Attribution |
|---|---|---|---|---|
| Organization | 1 | 1 | 0 | — |
| User | 11 | 11 | 0 | created 1 TEST user, deleted it |
| Department | 2 | 2 | 0 | created 1 TEST dept, deleted it |
| Job | 6 | 6 | 0 | created 2 TEST jobs, deleted both |
| Candidate | 19 | 19 | 0 | — |
| Application | 21 | 21 | 0 | — |
| CommunicationLog | 2 | 2 | 0 | — |
| Note | 0 | 0 | 0 | — |
| JobAssignment | 0 | 0 | 0 | — |
| AIEvaluation | 58 | 65 | **+7** | 2 screening + 2 TEXT answer evals + 1 TEXT overall + 2 VOICE answer evals |
| InterviewSession | 39 | 41 | **+2** | 1 TEXT + 1 VOICE UAT session |
| InterviewQuestion | 59 | 65 | **+6** | 3 + 3 |
| InterviewAnswer | 46 | 52 | **+6** | 3 + 3 |
| ProctoringEvent | 354 | 359 | **+5** | the 5 valid signals ingested in PRO-04 |
| TimelineEvent | 165 | 185 | **+20** | 10 STAGE_CHANGED, 2 each INTERVIEW_SCHEDULED/STARTED/COMPLETED, 2 SCREENING_COMPLETED, 1 AI_EVALUATION, 1 consent |

**Every delta is attributable to a deliberate UAT action. No unintended modification of any pre-existing record.**

### 19.2 Retained TEST fixtures — restored

| Fixture | State |
|---|---|
| Application `cmspldr2c000kjqylx1y8gg4v` | **`APPLIED / ACTIVE`** — original baseline restored |
| Candidate `cmspldr28000ijqyl4znuq8su` | `resumeText` 254 chars, embedding **768** dims — unchanged |
| Organization | `Logi Hiring` / `acme-hiring` / `Logi Hiring` — unchanged |
| Departments | `Engineering`, `People` — unchanged |
| Schema | 26 `ProctoringSignalType` values — unchanged |

### 19.3 UAT-created records

**Deleted after evidence capture:**
- Job `cmsvhfr100001zy1dnsabnonm` (via the application's own DELETE, 0 applications attached)
- Job `ccbbe26af5844f2f8df47c81d` (via the Django write path)
- User `c6aa265faf1ef2f327a7685cc` (`uat.testcase.*@example.com`) — no delete API exists, so the row was removed directly
- Department `c3a7495a00c88ee11d3b0d97d`

**Retained deliberately as evidence** (not deleted — they are the proof for §9, §10 and §11; delete only on operator instruction):
- InterviewSession `cmsvhq66o0003zy1dw8999h48` (TEXT) + 3 questions, 3 answers, 3 evaluations
- InterviewSession `cmsvi0j1t000szy1d2tr7qtha` (VOICE/ENHANCED/STRICT) + 3 questions, 3 answers, 5 proctoring events
- AIEvaluation `cmsvhm9rc000111nurtadpf2x` (screening) and `cmsvhwzfp0001rsewnlrda8r3` (interview overall)
- `storage/interviews/cmsvhq66o0003zy1dw8999h48/` — 3 cached TTS wavs + `proctoring-report.json`

### 19.4 No unauthorized changes

| Check | Result |
|---|---|
| Source files modified by this audit | **None.** 32 files show as modified in git — the identical set present at audit start. |
| `prisma/schema.prisma` | Untouched |
| Authentication / JWT / cookie code | Untouched |
| AI prompts / scoring / adaptive logic | Untouched |
| Live proctoring / secondary protocol | Untouched |
| Django migrations run against Prisma tables | **None** — `showmigrations` shows all unapplied |
| Django models with `managed=True` | **Zero**; no migrations directory in any app |
| `.env` | Restored byte-identically (md5 verified) |
| Phase 4C.4 | **Not started** |

---

## 20. Findings register

### Blocking

| ID | Sev | Finding | Root cause | Classification |
|---|---|---|---|---|
| **F-01** | BLOCKER | `aros-app` cannot start; entrypoint `prisma db push` would drop 9 in-use enum values | Image built from a pre-`59dbfac` schema; schema mutation in the container start path | Deployment / packaging |
| **F-02** | HIGH | Deactivated user's existing session still reaches Next.js staff APIs for up to 12 h | `requireUser`/`requireStaff` trust JWT claims; only `/api/auth/me` checks `isActive` | Security / authorization |
| **F-03** | MEDIUM | JOBS-05 — UI Job edit silently clears Department | Uncontrolled `<select defaultValue>` evaluated before async `/api/org` options load | Client-side data integrity |
| **F-04** | MEDIUM | Redis down → Django enqueue 500 + DEBUG traceback | Unhandled `ConnectionError`; `DJANGO_DEBUG=true` | Resilience / info disclosure |

### Warnings

| ID | Sev | Finding |
|---|---|---|
| W-01 | MEDIUM | Celery worker not running at audit start; only surfaced on the Django health endpoint |
| W-02 | MEDIUM | Two Ollama instances contend for 11434; the host one lacks `qwen2.5:7b` |
| W-03 | MEDIUM | Duplicate Next.js dev-server stacks caused app-wide HTTP 500s |
| W-04 | MEDIUM | `DJANGO_DEBUG=true` also disables secure-cookie flags |
| W-05 | MEDIUM | Unauthenticated Django health endpoint echoes raw exception strings (DB host/port/user, Redis URL) |
| W-06 | MEDIUM | No Django `LOGGING` config; auth failures not durably recorded |
| W-07 | MEDIUM | No DRF throttling on enqueue endpoints that spawn Node subprocesses and Ollama calls |
| W-08 | MEDIUM | `OLLAMA_API_KEY` still present in `.env` despite a comment saying it was cleared and should be treated as burned |
| W-09 | LOW | `resumeText` returned on the paginated candidate **list**, reachable by INTERVIEWER; the applications path defers the same field |
| W-10 | LOW | Finalize status reports `QUEUED` for its entire 210 s run, never `PROCESSING` |
| W-11 | LOW | Five `tests/unit/*.test.ts` files have no npm script and no CI step |
| W-12 | LOW | Role claim is not re-validated against the database (requires `AUTH_SECRET` to exploit; defence-in-depth only) |
| W-13 | LOW | Pilot compose uses a Docker volume for `/storage` while the host stack uses `./storage` |
| W-14 | LOW | `NEXT_PUBLIC_APP_NAME` brand drift in `.env` |

### Carried forward from earlier phases, still open

Confirmed still true: no durable processing status (Redis TTL only); no recording retention/TTL job; `.doc` unsupported on both stacks; staff `POST /api/documents/upload` performs no org check when only `candidateId` is supplied; per-answer scoring remains a fire-and-forget `void` on Next.js and is lost if the process dies mid-score; Windows Celery runs `-P solo`.

---

## 21. Final acceptance gates

| Gate | Result |
|---|---|
| Baseline all flags OFF | **PASS** |
| Authentication / RBAC / cross-org isolation | **PASS with one FAIL** (F-02) |
| Jobs / Candidates / Applications | **PASS with one FAIL** (F-03, Jobs UI edit) |
| Resume processing | **PASS** |
| AI screening remains advisory | **PASS** |
| TEXT interview | **PASS** |
| VOICE / STT / TTS | **PASS** |
| Live proctoring | **PASS** |
| Secondary-camera physical UAT | **BLOCKED — operator must complete** |
| Post-session processing and recruiter playback | **PASS** |
| Admin UAT | **PASS** |
| Each Django flag independently | **PASS** (all five) |
| Combined approved configuration | **PASS** |
| Failure handling and rollback | **PASS with one FAIL** (F-04) |
| Automated regression tests | **PASS** (176/176) |
| Database integrity | **PASS** |
| No unauthorized source/schema/auth changes | **PASS** |
| Packaged / pilot deployment | **FAIL** (F-01) |

---

## 22. Final recommendation — **NO-GO**

**NO-GO for deployment. GO to continue local UAT on the Next.js + Prisma stack with all five flags off.**

The Django migration work is not the problem. Phases 3A through 4C.3 hold up under direct testing: parity is exact, every flag switches only what it claims to, every flag fails closed with a 503 and no silent Prisma fallback, rollback is clean, and the architectural boundaries — AI never moves an application stage, proctoring never enters a prompt, the live interview loop never waits on Celery or Redis — held under every test performed.

Three things must close before a deployment sign-off:

1. **F-01** — the pilot image cannot start, and the suggested remedy is destructive. Rebuild the image; reconsider `prisma db push` in a container entrypoint.
2. **F-02** — deactivating a user does not end their session. This is the most serious finding, because deactivation is the mechanism an organization relies on when someone leaves.
3. **Secondary-camera physical UAT** — thirteen tests, still unproven after three phases. Enhanced mode should not be considered validated until an operator completes them on a real device.

**F-03** (JOBS-05) should be fixed before recruiters use the Job editor, since it corrupts data silently on every save. **F-04** and the DEBUG/logging/throttling warnings should be closed before any deployed environment.

Once F-01 and F-02 are resolved and the secondary-camera UAT is signed off, the remaining evidence supports a GO.

**Phase 4C.4 was not started, as instructed.**

---

## 23. Operator sign-off

| Area | Status | Evidence / notes |
|---|---|---|
| Automated UAT | **PASS** | 176/176 — 148 Django, 22 isolation, 6 CV; `manage.py check` clean |
| Authenticated UI UAT | **PASS with 1 FAIL** | Six roles verified; JOBS-05 reproduced in the browser (F-03) |
| Secondary phone/device UAT | **BLOCKED** | 13 tests require a physical device — §12 |
| Recording / playback | **PASS** | 4 real recordings ffprobed h264+aac; HTTP 206 range playback; `proctoring_artifacts` 6/6 |
| Feature-flag combined mode | **PASS** | All five independently and combined |
| Rollback | **PASS** | All flags off; Prisma restored; 503 fail-closed with no silent fallback |
| Database integrity | **PASS** | Every row-count delta attributed; TEST fixtures restored; `.env` md5-identical |
| Deployment / packaging | **FAIL** | F-01 — `aros-app` cannot start |
| **Final GO / NO-GO** | **NO-GO** | Blocked by F-01 and F-02; secondary-camera UAT outstanding |

---

*Audit performed read-only. No source, schema, authentication, AI-prompt, interview-engine or proctoring-architecture changes were made. `--accept-data-loss` was never run. Phase 4C.4 was not started.*
