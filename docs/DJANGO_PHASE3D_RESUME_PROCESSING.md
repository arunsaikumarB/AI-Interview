# Logisoft HireOS — Django Phase 3D: Resume processing + Celery

**Status:** Complete (async path proven). Next.js upload remains synchronous and unchanged.  
**Date:** 2026-08-15  
**Audit:** `docs/DJANGO_PHASE3D_RESUME_AUDIT.md`

Prisma schema was **not** changed. No new Candidate/resume table. No AI Screening / Interviews / Proctoring / Application writes / general Candidate writes.

---

## 1. Existing resume pipeline (unchanged)

Staff `POST /api/documents/upload`, portal `PUT /api/portal/profile`, and careers apply still parse + embed **inside the HTTP request**.

Storage: `STORAGE_ROOT/resumes/{timestamp}-{uuid8}-{sanitizedName}` on local disk.  
Parser: Node `extractResumeText` (pdf-parse, mammoth, UTF-8 txt). **`.doc` is not supported** (extension list is `.pdf` / `.docx` / `.txt`).  
Embeddings: local Ollama `nomic-embed-text`, `POST /api/embeddings`, **768-d**, blob = summary + skills + experience + resumeText truncated to **6000** chars.  
`Candidate.resumeUrl` / `resumeText` / `embedding` remain Prisma columns. There is **no** processing-status column.

---

## 2. New Celery architecture

```
POST /api/v1/resumes/process/  { "candidate_id" }
        ↓ Redis SET NX lock
        ↓ HTTP 200 { status, task_id }   (no parse, no embed)
        ↓ Celery files.process_resume(candidate_id, organization_id)
        ↓ Node extractResumeText (same parser as Next.js)
        ↓ UPDATE "Candidate"."resumeText"
        ↓ local Ollama embed
        ↓ UPDATE "Candidate".embedding = $1::vector
        ↓ release lock
```

Task arguments are **IDs only**. The worker resolves `Candidate.resumeUrl` under `STORAGE_ROOT/resumes/` and refuses path traversal / paths outside that tree. Unauthenticated callers cannot supply a filesystem path.

---

## 3. Storage

Same `STORAGE_ROOT` as Next.js (repo `storage/` by default). Relative `STORAGE_ROOT` is resolved from Django `BASE_DIR`. No S3/cloud storage.

---

## 4. Parser

`scripts/extract-resume.mjs` calls `src/lib/resume/parse.ts` via `tsx`. CWD is the repo root so pdf.js worker paths resolve. Timeout: **90s** (`RESUME_PARSE_TIMEOUT_SECONDS`). Output is a temp JSON file (not logged).

Live parity on designated test candidate `taylor.testcase@example.com`: Node extract **254** chars, SHA-256 matched `Candidate.resumeText` after Celery.

---

## 5. Embedding model

| Item | Value |
|---|---|
| Model | `nomic-embed-text` (`OLLAMA_EMBED_MODEL`) |
| Endpoint | local `OLLAMA_LOCAL_URL` `/api/embeddings` only (never cloud) |
| Dimension | **768** — mismatch is a **permanent** failure (no pad/truncate; embedding not written) |
| Timeout | `OLLAMA_EMBED_TIMEOUT_SECONDS` (default 240s, aligned with Next `OLLAMA_TIMEOUT_MS`) |
| Blob | identical `buildCandidateEmbedText` recipe, 6000 chars |

If embed fails after text extract, `resumeText` may already be saved; status is not `completed`. Transient Ollama errors retry; wrong dimension does not.

---

## 6. Queue behavior

`POST /api/v1/resumes/process/` is recruitment staff only (`canManagePipeline`: SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER). **INTERVIEWER 403. CANDIDATE 403.** Unauthenticated **401**.

Organization is taken from the JWT. Unknown or other-org candidate → **404**. Missing/unreadable resume → **400**. Response body is only `{ status, task_id }` (no paths).

Live enqueue: **~116–123 ms** (no Ollama wait). Celery wall time on the test `.txt` was **~1.8 s** including embed.

`GET /api/v1/resumes/status/?candidate_id=` returns Redis status (`queued` / `processing` / `retrying` / `completed` / `failed` / `idle`) plus optional `resume_text_length` / `embedding_dims` after success.

---

## 7. Idempotency

Redis key `hireos:resume:lock:{candidate_id}` — `SET NX` with TTL **600s**, value = Celery `task_id`.

Second POST while locked → **200** `{ "status": "already_processing", "task_id": "<existing>" }` (not a second worker). Worker verifies the lock matches its task id (`duplicate_execution` otherwise).

No new database table.

---

## 8. Retry policy

| Class | Examples | Behavior |
|---|---|---|
| Transient | Ollama down/timeout, OSError, parser timeout, DB blip | Retry up to **4** times, countdown `min(60, 5 * 2^n)` seconds |
| Permanent | missing candidate/file, unsupported type, empty text, parser failure, dim ≠ 768, path escape | **No retry**; lock released; status `failed` |

Celery `time_limit` **360s**, `soft_time_limit` **330s**. After max retries: `retries_exhausted`, lock released.

---

## 9. Failure handling

Structured logs on logger `hireos.resume`: `candidate_id`, `organization_id`, `task_id`, `stage`, `success`, `error_class`. Celery result dict is `{ ok, candidate_id, resume_text_length, embedding_dims }` or `{ ok, error_class, retryable }`.

Never logged: resume body, embeddings, passwords, secrets. API errors are error classes / DRF detail, not stack traces.

---

## 10. Security

- AuthN: existing HireOS JWT (`aros_session` / Bearer).
- AuthZ: `RecruitmentStaff` + JWT `organizationId` (stricter than Next.js staff `candidateId` upload, which does not re-check candidate org).
- File: extension allowlist, 10MB cap, `resumes/` prefix, `Path.resolve` + `relative_to(storage_root)`.
- SQL: parameterized `psycopg` placeholders only. Vector written as `%s::vector` with a numeric literal built from floats (no user string interpolation of SQL).
- Django ORM is **not** used for the `embedding` column (unmanaged Candidate omits it).

---

## 11. Logging / observability

Redis status key `hireos:resume:status:{candidate_id}` (TTL 24h) plus Celery result backend. Stages: `queued` → `started` → `file_validated` → `text_extracted` → `resume_text_saved` → `completed` (or `retrying` / `failed`).

There is still **no** Prisma `resumeProcessingStatus`. Recommended future enum if product UI needs durability: `PENDING | PROCESSING | COMPLETED | FAILED` on Candidate, additive Prisma migration only — **not** done in 3D.

---

## 12. API trigger

`POST /api/v1/resumes/process/` reprocesses an **already stored** resume. It does **not** replace Next.js upload. Chosen because upload stays in Next.js and this path can be proven without changing the portal.

---

## 13. Real environment test

Stack: PostgreSQL `:55432`, Redis `:6379`, Ollama `:11434`, Django `:8000`, Celery worker (`-P solo` on Windows).

Designated test candidate: **`taylor.testcase@example.com`** (`cmspldr28000ijqyl4znuq8su`) — existing local `.txt` under `storage/resumes/`. Personal/production-like emails were not used.

| Check | Result |
|---|---|
| File on disk | yes |
| Enqueue | `queued`, **115.7 ms** |
| Celery | `files.process_resume` succeeded **1.78 s** |
| Parser SHA-256 vs DB `resumeText` | match (254 chars) |
| `vector_dims(embedding)` | **768** |
| Duplicate while locked | `already_processing`, same `task_id` |
| HTTP unauth / candidate | **401** / **403** |
| HTTP queue / duplicate | **200 queued** (101.7 ms with a single worker) / **200 already_processing** (earlier live check) |
| HTTP → same worker | task `c3a0e7d3-…` succeeded **1.05 s**, `resume_text_length` 254, dims 768 |
| Jobs / Candidates / Applications GET | **200** |
| Worker logs | ids/stages only; no resume body |

Stale extra Celery workers (started before this task existed) can steal the job and fail with `NotRegistered`. Run **one** worker from current `backend` code (`celery -A config worker -l info -P solo` on Windows).

Command: `python manage.py resume_process_smoke --email taylor.testcase@example.com --wait`

---

## 14. Existing Next.js compatibility

No frontend changes. Sync upload/parse/embed still runs in Next.js. Django only **reprocesses** stored files. Same parser and embed model, so `resumeText` / 768-d `embedding` remain what the talent-pool SQL expects.

---

## 15. Known limitations

- Next.js upload is still **synchronous**; 3D does not hook it.
- No durable DB status field; Redis TTL means status can expire.
- `.doc` remains unsupported (same as Next).
- Staff trigger is org-scoped via JWT (Django Phase 2 rule), including SUPER_ADMIN.
- Parser subprocess requires repo `node_modules` + `tsx`.
- Embed failure after text save leaves text updated and status failed/retrying.
- Celery `solo` pool on Windows (not prefork).

---

## 16. Future migration requirements (not in 3D)

- Optional Prisma status (+ `resumeProcessedAt`, last error class).
- Switch Next.js upload to enqueue this task after `saveUpload` (keep sync fallback until then).
- Delete replaced resume files (Next.js also does not).
- Do **not** start Phase 3E (screening) without approval.

---

## Tests

`python manage.py test apps.accounts apps.jobs apps.candidates apps.applications apps.files` → **69 OK**.

Ollama/Celery integration was run against the live local stack, not mocked as a pass.
