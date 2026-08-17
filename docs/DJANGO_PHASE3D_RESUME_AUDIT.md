# Logisoft HireOS — Phase 3D resume pipeline audit

**Status:** Audit only (written before implementation).  
**Date:** 2026-08-15  
**Sources:** `src/app/api/documents/upload/route.ts`, `src/app/api/portal/profile/route.ts`, `src/app/api/careers/apply/route.ts`, `src/lib/storage.ts`, `src/lib/resume/mime.ts`, `src/lib/resume/parse.ts`, `src/lib/ai/embeddings.ts`, `src/lib/ai/ollama.ts`, Prisma `Candidate`.

---

## 1. Upload entry points (all synchronous today)

| Path | Who | Auth |
|---|---|---|
| `POST /api/documents/upload` | Staff | `requireStaff` + `canManagePipeline` (SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER). **INTERVIEWER cannot upload.** `CANDIDATE` 403. |
| `PUT /api/portal/profile` | Candidate portal | `requireCandidate`; own `Candidate` via `userId`. |
| `POST /api/careers/apply` | Public apply | No session; creates/updates candidate on org from job. |

There is **no Celery/queue**. Parse + embed run **inside the HTTP request**. Embed failures are logged and **do not fail the upload**.

---

## 2. Authorization gaps (existing)

Staff upload with `applicationId`: org checked via `application.job.organizationId`.  
Staff upload with **only `candidateId`**: `canManagePipeline` only — **no org check** on that branch.

Django Phase 3D trigger will **require org match** (stricter, documented).

---

## 3. File validation

- Max size: **10MB** (`RESUME_MAX_BYTES`).
- Extensions: **`.pdf`, `.docx`, `.txt`** only.
- MIME allowlist: pdf, docx, `application/msword`, text/plain, text/markdown; empty/`octet-stream` allowed if extension ok.
- **`.doc` (legacy Word) is not in the extension list** — effectively unsupported despite `application/msword` in the MIME set.
- Client filename is sanitized (`[^a-zA-Z0-9._-]` → `_`) then prefixed `timestamp-uuid8-`.
- Client MIME is passed into the parser but format is also inferred from extension.

---

## 4. Storage

- Root: `STORAGE_ROOT` or `./storage` (repo-relative).
- Category: `resumes/`.
- Relative path stored on `Candidate.resumeUrl` (not a public URL).
- `resolveStoragePath` rejects path traversal (`resolved.startsWith(root)`).
- No cloud storage.

---

## 5. Parsing

`extractResumeText` in `src/lib/resume/parse.ts`:

| Format | Library |
|---|---|
| PDF | `pdf-parse` (pdfjs) + DOM polyfills |
| DOCX | `mammoth.extractRawText` |
| TXT/MD | UTF-8 string |

No separate DOC parser. Empty PDF text throws. Clean: CRLF, trailing spaces, collapse blank lines.

Loaded **fully into a Buffer** in the request (up to 10MB).

---

## 6. Candidate writes

`prisma.candidate.update`:

- always `resumeUrl`
- `resumeText` **only if parse succeeded** (failed parse leaves previous text)

No processing-status column. No resume table.

---

## 7. Embeddings

`embedCandidate(id)`:

- Blob: summary + `Skills: …` + `Experience: N years` + resumeText, **truncated to 6000 chars**.
- Local Ollama `POST /api/embeddings` — model `nomic-embed-text` (env `OLLAMA_EMBED_MODEL`).
- Timeout default **240s** (`OLLAMA_TIMEOUT_MS`).
- Writes via raw SQL: `UPDATE "Candidate" SET embedding = $1::vector …` with literal `[n,n,…]`.
- Expected **768** dims; mismatch is **warned, still written** in Next.js.
- Always local; never cloud. Failures are swallowed at upload call sites.

---

## 8. pgvector

`Candidate.embedding Unsupported("vector(768)")`. Talent search uses `<=>`. Django unmanaged Candidate **omits** this column (Phase 3B) — writes must use parameterized SQL, not the ORM field.

---

## 9. Duplicates / cleanup

- No lock. Two parallel uploads can race.
- Old files are **not** deleted when a new resume is saved.
- No idempotency key.

---

## 10. Loading / status UX

API returns `{ parsed, parseError, resumeTextLength }`. UI infers “extracted” from `resumeText` length. No PENDING/PROCESSING enum.

---

## 11. Implications for Celery

- Reuse **Node `extractResumeText`** (same pdf-parse/mammoth) for parser parity.
- Reuse **nomic-embed-text / 768** and the same embed text recipe.
- Do **not** add a Prisma status column in this phase — Redis lock + Celery state.
- Trigger is **reprocess existing stored file**, not a replacement of Next.js upload.
- Django Phase 3D must **not** silently write non-768 vectors (stricter than Next.js warn-and-write).
