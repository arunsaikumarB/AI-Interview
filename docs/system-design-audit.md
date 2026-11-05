# System design audit

Audit of Logisoft HireOS against `.cursor/rules/system-design.mdc`. No application code was changed.

HireOS is a self-hosted ATS (Next.js 14, Prisma, PostgreSQL/pgvector, local Ollama, optional Django/Celery). It is not a small static site, so all nine areas apply. Depth is for a single-office deployment, not a public multi-region service. A commercial CDN does not fit the local-only rule.

Existing rules in `.cursor/rules/` were left in place (`hireos-guardrails.mdc`, `hireos-security.mdc`, `lets-go.mdc`), along with `.cursorrules` and `AGENTS.md`.

## Rule conflicts (both kept)

1. **Local disk vs stateless object storage.** HireOS requires files on local disk (`STORAGE_ROOT`, `/storage`) and forbids cloud storage. The new standard says process state must not live on local disk, and uploads should sit in object storage (S3, R2, GCS) behind a CDN. Keep local disk. Treat shared storage as a later on-prem volume, not a cloud bucket.
2. **Cloud examples vs local-only production.** The new standard names CDN, Sentry, and SQS as examples. Production stays local. Use on-prem equivalents (nginx, structured logs, Celery/Redis) and do not add those cloud services to satisfy the checklist.
3. **CSP strictness.** `hireos-security.mdc` and `hireos-guardrails.mdc` say not to add `'unsafe-inline'` or `'unsafe-eval'`. The new standard asks for a strict CSP, which matches that intent. Current code already allows `style-src 'unsafe-inline'` (and dev-only `unsafe-eval`) in `src/lib/security-headers.ts`, with a written reason. This audit does not propose a drive-by CSP change.

## 1. System architecture

**Applies.** Two stacks: Next.js is the UI and the default API. Django under `backend/` exposes versioned routes and is off unless cutover flags in `.env.example` are set.

**In place**

- Session and RBAC live in `src/lib/auth/`. Many domains have service modules (`src/lib/ai/`, `src/lib/assessment/`, `src/lib/practical/`).
- Django splits views, services, and repositories (`backend/apps/*/views.py`, `backend/services/`).
- Public Django routes are versioned in `backend/config/urls.py` (`/api/v1/…`).
- Request bodies on newer Next routes use Zod (example: `src/app/api/jobs/route.ts`). Django uses DRF serializers.
- Config is environment-driven: `.env.example`, `.env.docker.example`. Cookies are JWT, not server-side session memory (`src/lib/auth/cookie-options.ts`).

**Gaps**

- Next route handlers query Prisma directly (`src/app/api/jobs/route.ts`, `src/app/api/applications/board/route.ts`, `src/app/api/documents/upload/route.ts`). Controllers and data access are mixed.
- Next APIs are unversioned (`/api/…`).
- Uploaded files and the in-memory rate limiter are process-local (see caching and scalability).

**Fixes**

- **High:** New Next handlers should call `src/lib` services. Leave existing routes alone until a route is already being changed.
- **Medium:** Treat Django `/api/v1` as the versioned staff API. Document that Next `/api` is the BFF and is not a second public contract.
- **Low:** Draw the cutover flags (`NEXT_PUBLIC_USE_DJANGO_*`) on one diagram so operators know which process owns a write.

## 2. Load balancing

**Applies** as a single reverse proxy in front of one app, not as a multi-instance balancer. Docker Compose runs one `app` container (`docker-compose.yml`). CentOS deploy puts nginx in front of one Node process (`docs/DEPLOYMENT-CENTOS9.md`, `deploy/systemd/hireos-app.service`).

**In place**

- Next `GET /api/health` checks Postgres, Ollama, and speech. Public callers get booleans only (`src/app/api/health/route.ts`, `src/lib/health-payload.ts`). Speech can be down without failing readiness.
- Django `GET /api/v1/health/` probes Postgres, Redis, and Celery and stays boolean-only (`backend/common/views.py`).
- Speech, Postgres, and Ollama have container healthchecks (`docker-compose.yml`).
- Auth does not need sticky sessions (JWT cookie).
- nginx sets `X-Forwarded-Proto` and `X-Forwarded-For` (`docs/DEPLOYMENT-CENTOS9.md`). Caddy terminates LAN HTTPS (`docker/caddy/Caddyfile`).
- systemd `TimeoutStopSec=20` gives the process a short stop window.

**Gaps**

- No separate liveness vs readiness URLs. Django health calls Celery inspect (1s) on every hit, so a dead worker slows the probe. HTTP status is 503 only when Postgres is down; `ok` also requires Redis.
- No application SIGTERM handler that stops accept, drains in-flight work, and closes Prisma/Redis.
- `clientIp()` in `src/lib/rate-limit.ts` trusts the first `X-Forwarded-For` hop with no trusted-proxy check.

**Fixes**

- **High:** Count forwarded IPs only from the known nginx/Caddy hop. Ignore client-supplied `X-Forwarded-For` when the app is reached directly.
- **Medium:** Add a cheap liveness route that does not call Celery or Ollama. Keep today's dependency probe as readiness.
- **Low:** On SIGTERM, stop accepting and disconnect Prisma. Twenty seconds in systemd is enough for the current process model.

## 3. Caching

**Applies** for HTTP headers and a few hot reads. A shared read cache is optional at this size.

**In place**

- Redis exists only for Celery and short locks (`backend/docker-compose.yml`, `backend/services/resume/locks.py`, `backend/services/screening/locks.py`). It is not a response cache.
- Private media sets `Cache-Control: private, no-store` (resumes, recordings, practical state). Examples: `src/app/api/candidates/[id]/resume/route.ts`, `src/app/api/interviews/[id]/secondary-recording/file/route.ts`.
- Next fingerprints `/_next/static` (framework default). `next.config.mjs` adds nosniff on those assets and does not override that cache.

**Gaps**

- Authenticated JSON list routes do not set `Cache-Control: no-store`.
- No ETag/Last-Modified on file downloads beyond framework defaults.
- No TTL cache with an invalidation path for jobs, board, or analytics.
- Redis is started with `--save "" --appendonly no`, so it cannot be treated as durable cache or queue storage.

**Fixes**

- **Medium:** Default `Cache-Control: no-store` on authenticated `/api/*` responses. Keep the explicit private headers on file routes.
- **Low:** Add a Redis or in-process TTL cache only after a measured slow read (analytics is the likely candidate). Key any per-user entry by user id.
- **Low:** Leave hashed static assets on Next's immutable cache. Do not put resumes or recordings on a shared cache.

## 4. Database design

**Applies.**

**In place**

- PostgreSQL 16 + pgvector (`docker-compose.yml`, `docker/postgres/init.sql`).
- Prisma schema uses `createdAt` / `updatedAt`, foreign keys, uniques, and indexes on org, stage, status, and common filters (`prisma/schema.prisma`). Embedding HNSW is migration `prisma/migrations/20260812010000_candidate_embedding_hnsw`.
- Schema changes have SQL migrations under `prisma/migrations/`.
- Django list APIs paginate (page size 25, max 100), e.g. `backend/apps/jobs/pagination.py`.
- Org scope is applied in staff queries (`orgScopeWhere` in `src/lib/auth/rbac.ts`).
- Timeline tables keep history for stage moves and notes even when a row is deleted elsewhere.

**Gaps**

- Next list routes are unbounded: `prisma.job.findMany` in `src/app/api/jobs/route.ts` and `prisma.application.findMany` in `src/app/api/applications/board/route.ts`.
- Django pagination is offset/page, not cursor.
- No PgBouncer or explicit pool size. Prisma uses its default pool (`src/lib/db.ts`).
- Soft delete is not a general pattern (tags hard-delete in `src/app/api/tags/[id]/route.ts`). History that matters is already in timeline/decision tables.
- CI applies schema with `prisma db push`, not `migrate deploy` (`.github/workflows/isolation.yml`). Guardrail R-4 (migration baseline) is still an open operational item; this audit does not close it.

**Fixes**

- **High:** Paginate `GET /api/jobs` and cap or page the kanban query (stage + cursor, or a max page with a job filter required).
- **Medium:** Run `prisma migrate deploy` in deploy docs and CI once R-4 is explicitly approved. Until then, do not invent a new baseline.
- **Low:** Add a pooler only when more than one app instance shares Postgres. Prefer hard deletes plus timeline rows over a global `deletedAt`.

## 5. Message queues

**Applies** for AI, resume parse, interview finalize, and proctoring assembly. Email can stay synchronous while SMTP is optional.

**In place**

- Celery app `backend/config/celery.py`, broker Redis (`backend/config/settings/base.py`): `acks_late`, JSON serializer, soft/hard time limits.
- Tasks for resume, screening, interviews, and proctoring retry transient failures and record a terminal failure (`backend/apps/files/tasks.py`, `backend/apps/screening/tasks.py`, `backend/apps/interviews/tasks.py`, `backend/apps/proctoring/tasks.py`). Redis locks reject duplicate execution.
- Django maps a down broker to HTTP 503 without echoing the connection string (`backend/common/exception_handlers.py`).
- Practical submit already returns 202 (`src/app/api/practical/[token]/submit/route.ts`).
- Flags default **off** (`.env.example`): Next still does resume parse, screening, and interview work in the request. That matches the documented rollback.

**Gaps**

- No dead-letter queue and no alert when retries are exhausted.
- Redis has no persistence (`backend/docker-compose.yml`), so a restart drops queued jobs.
- With flags off, slow Ollama work holds the Next request (Ollama timeout defaults to 240s in `src/lib/ai/ollama.ts`).
- Idempotency is lock-based for those Celery tasks, not a general idempotency key for email or webhooks.

**Fixes**

- **High:** When a Celery task hits `retries_exhausted`, write one durable failure row and a log line operators can alert on. Persist Redis (`appendonly yes`) if queued work must survive restart.
- **Medium:** Keep the async flags off until cutover is approved. After that, resume/screen/finalize should return a job id and a status URL, which the Django routes already trend toward.
- **Low:** Idempotency key on outbound email once SMTP is actually used.

## 6. CDN

**Does not apply as a third-party or multi-region CDN.** The product is on-prem / LAN. Static delivery through nginx or Caddy still applies.

**In place**

- Fonts and MediaPipe are self-hosted (`src/lib/security-headers.ts` notes `next/font` and `/mediapipe`).
- Caddy enables gzip (`docker/caddy/Caddyfile`).
- CentOS nginx enables HTTP/2 and a 50 MB body cap (`docs/DEPLOYMENT-CENTOS9.md`).
- Uploads stay on the app volume (`src/lib/storage.ts`, compose volume `app_storage`), with path traversal checks.

**Gaps**

- The nginx sample has HTTP/2 and no `gzip`/`brotli`.
- No image pipeline (WebP/AVIF, responsive sizes). Careers pages are not a media site; interview recordings must stay authorized, not public CDN objects.
- One disk volume means a second app instance cannot see uploads.

**Fixes**

- **Medium:** Add gzip (or brotli) to the nginx site config for text assets. Keep recordings and resumes off any shared cache.
- **Low:** If a second app node is required, mount one shared on-prem volume at `STORAGE_ROOT`. Do not move files to cloud object storage.
- **Low:** Lazy-load below-the-fold images only if a careers page is actually heavy.

## 7. Scalability

**Applies** in the single-node sense: protect the one box, and avoid designs that cannot add a second box later. Expected load is one recruiting team plus candidates on interview links. First bottleneck is local Ollama, then large unpaged board queries, then disk I/O for recordings.

**In place**

- Stateless JWT sessions.
- In-process sliding window (`src/lib/rate-limit.ts`) on careers apply, practical routes, and assessment generation.
- Timeouts: Ollama (`src/lib/ai/ollama.ts`), Celery task limits, nginx `proxy_read_timeout 300s`, sandbox statement timeouts.
- `output: "standalone"` in `next.config.mjs` is suitable for one container.

**Gaps**

- Rate limit state is per process and is not applied to `POST /api/auth/login` or `POST /api/auth/register`.
- Horizontal scale is blocked by local disk, in-memory limits, and a single compose service with no shared queue in the main stack (Redis is a separate compose file and is not in the pilot stack).
- The kanban board loads every matching application into memory.

**Fixes**

- **High:** Rate-limit login, register, and token interview posts. Keep limits in Redis before running more than one Node process.
- **Medium:** Require `jobId` (or a page size) on the board API so one open job cannot pull the whole table.
- **Low:** Write the expected load next to any new AI feature: one office, model latency is the bottleneck, do not fan out parallel Ollama calls from the browser.

## 8. Reliability and security

**Applies.**

**In place**

- Next `handleApiError` maps auth failures, Zod errors, and known Prisma outages to JSON (`src/lib/api.ts`). Django hides broker errors (`backend/common/exception_handlers.py`).
- Speech outage does not fail Next readiness (`src/lib/health-payload.ts`).
- Backup and restore steps are documented (`docs/DEPLOYMENT-CENTOS9.md` `pg_dump` plus storage tar; `docs/DEPLOYMENT-DATABASE-V3.1.md`).
- Tests exist for units, isolation, Django apps, and security headers. GitHub Actions runs the isolation suite (`.github/workflows/isolation.yml`).
- Passwords use bcrypt (`src/app/api/auth/login/route.ts`, cost 12 on register and bootstrap).
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production or on HTTPS (`src/lib/auth/cookie-options.ts`).
- CSP nonce, `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy, and HSTS on HTTPS (`src/lib/security-headers.ts`, `src/middleware.ts`).
- RBAC on staff routes. Queries go through Prisma or the ORM. Upload paths are checked in `src/lib/storage.ts`.
- Public health payloads omit URLs and paths (`tests/unit/health-payload.test.ts`).

**Gaps**

- `handleApiError` returns `err.message` on unknown errors (`src/lib/api.ts`). That can surface SQL, paths, or dependency text to the client.
- No circuit breaker around Ollama. A stuck model holds workers until the 240s timeout.
- Backups are manual. Nothing in repo schedules them or checks a restore.
- CI does not run `npm run test:unit`, Django tests, `npm audit`, or `pip-audit`. No Dependabot config.
- `style-src 'unsafe-inline'` remains, as documented. Login has no rate limit (also listed under scalability).

**Fixes**

- **High:** Unknown errors should return a fixed "Internal server error" and log the detail server-side only.
- **High:** Rate-limit authentication (same item as scalability).
- **Medium:** Add a cron or systemd timer that runs the documented `pg_dump` and storage tar, and restore once into a scratch database.
- **Medium:** Extend CI to unit tests. Add `npm audit` / `pip-audit` as a non-blocking report first.
- **Low:** After repeated Ollama timeouts, fail fast with the existing honest failure state (no fabricated score). Do not add a cloud model fallback.

## 9. Monitoring

**Applies.** Core Web Vitals matter for the staff and candidate web app, and they are secondary to API and Ollama health.

**In place**

- Next logs with `console.error` (`src/lib/api.ts` and several routes). Django uses `logging.getLogger("hireos.api")` for broker outages.
- Pilot scripts and CI poll `/api/health`.
- nginx serves a maintenance page on 502/503/504 (`deploy/nginx/hireos-maintenance.html`).

**Gaps**

- Logs are unstructured text. No request id is generated or passed to Django, Celery, or Ollama.
- No error tracker, no metrics (rate, error, latency, queue depth, DB), no alert on health failure.
- No Core Web Vitals collection.
- Celery retry exhaustion is only a task return value, not an alert.

**Fixes**

- **High:** JSON logs with level, timestamp, and a request id on Next and Django. Propagate that id into Celery task kwargs. Do not log passwords, tokens, resumes, or full answers.
- **Medium:** Scrape `/api/health` and `/api/v1/health/` on an interval from the same host. Alert when `ok` is false. Track Celery failures from the durable row in the queue fix.
- **Low:** Record LCP/CLS/INP in the app only if it stays on-prem. Skip Sentry unless a self-hosted tracker is already approved.

## Top gaps

1. **Auth and proxy trust.** Login/register are not rate-limited, and `X-Forwarded-For` is trusted blindly (`src/lib/rate-limit.ts`).
2. **Client error leakage.** `handleApiError` can return raw exception text (`src/lib/api.ts`).
3. **Unbounded reads.** Jobs and the pipeline board load full lists (`src/app/api/jobs/route.ts`, `src/app/api/applications/board/route.ts`).
4. **Queue durability.** Celery is optional, Redis is ephemeral, and exhausted retries have no dead-letter alert. Default path still runs AI inside the HTTP request.
5. **No operational telemetry.** Logs are unstructured, there is no request id, and health is polled by scripts only. Backups are documented, not scheduled.
