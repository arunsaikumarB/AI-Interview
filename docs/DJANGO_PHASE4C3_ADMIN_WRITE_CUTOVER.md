# Logisoft HireOS — Django Phase 4C.3: Admin / user / organization write cutover

**Status:** Implemented. Feature flag **defaults OFF**.  
**Date:** 2026-08-16  
**Does not start Phase 4C.4.**

Audit (before implementation): `docs/DJANGO_PHASE4C3_ADMIN_WRITE_AUDIT.md`.

Authentication remains Next.js. Cookie **`aros_session`** is unchanged. Django only validates that JWT. Login, JWT claims, and password hashing algorithm are unchanged.

---

## 1. Actual mutations discovered

Staff admin UI: `/dashboard/admin` → `AdminConsole`. `requireAdmin`: **SUPER_ADMIN**, **HR_ADMIN**.

| Mutation | Next.js | Present |
|---|---|---|
| Create staff user | `POST /api/admin/users` | YES |
| Patch staff user (`name`, `isActive`, `role`, `departmentId`) | `PATCH /api/admin/users/:id` | YES |
| Create department | `POST /api/admin/departments` | YES |
| Rename department | `PATCH /api/admin/departments/:id` | YES |
| Delete department (blocked if users/jobs) | `DELETE /api/admin/departments/:id` | YES |
| Patch org `name` / `companyName` | `PATCH /api/admin/org` | YES |
| List users / depts / org | GET `/api/admin/*` | Reads only — not this phase |
| Delete user | — | NOT PRESENT |
| Password reset / change password | — | NOT PRESENT |
| Change user `organizationId` | — | NOT PRESENT |
| Change user email | — | NOT PRESENT |
| Create / delete organization | — | NOT PRESENT |
| Admin audit / timeline events | — | NOT PRESENT |

---

## 2. Mutations migrated

With `NEXT_PUBLIC_USE_DJANGO_ADMIN_WRITES=true`:

- Create staff user
- Patch staff user (whitelisted fields only)
- Create / rename / delete department
- Patch organization name and companyName

Browser → same-origin Next BFF → Django. Cookie forwarded server-side. No Celery. No AI.

---

## 3. Mutations intentionally not migrated

| Item | Disposition | Why |
|---|---|---|
| Login / cookie / JWT | KEEP NEXT.JS | Auth source of truth |
| `GET /api/auth/me`, Django `GET /api/v1/accounts/me/` | unchanged | Auth regression |
| Register / careers apply | KEEP NEXT.JS | Not admin writes |
| Admin GETs | KEEP NEXT.JS | Reads (4A) |
| User delete | NOT PRESENT | Would risk Job `createdBy` restrict / interviews |
| Password reset / change | NOT PRESENT | Do not invent; hashes never go through Celery |
| User organization change | NOT PRESENT | Would stale JWT `organizationId` |
| Email change | NOT PRESENT | |
| Org create / delete | NOT PRESENT | Deletion would cascade recruitment data |
| Tags / notes / candidates / interviews / proctoring | out of scope | |

---

## 4. User security model

- Targets must be staff (`role != CANDIDATE`).
- Create never assigns `CANDIDATE`.
- Org on create comes from JWT, not the browser (`organizationId` stripped in BFF; extra keys → 400 on Django).
- Duplicate email → **409** `"Email already in use"`.
- Cannot deactivate self → **400**.
- Cross-org user PATCH → **404** `"User not found"` (no existence leak).
- `passwordHash` is written with parameterized SQL on create only. The unmanaged `HireOSUser` model **omits** `passwordHash`. JSON never includes it. Temporary password is returned **once**.

---

## 5. Password handling

| Topic | Behavior |
|---|---|
| Create | Random 12-char temp password; **bcrypt cost 12** (`bcrypt.hashpw` / gensalt 12), compatible with Next `bcryptjs.hash(..., 12)` and `bcrypt.compare` at login |
| Reset / change | NOT PRESENT — not migrated |
| Logging | Temp password and hash are not logged |
| Celery | Not used |
| Login | Unchanged Next.js `POST /api/auth/login` |

---

## 6. Role handling

Prisma `Role`: SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER, CANDIDATE.

- HR_ADMIN cannot create SUPER_ADMIN (**403**).
- Only SUPER_ADMIN can change roles (BFF + Django).
- JWT `role` is minted at **login**. This phase does **not** refresh cookies after a role change. The user must log in again (or wait for session expiry) for JWT-gated APIs to see the new role. Database `User.role` updates immediately (Next list GETs use Prisma).

---

## 7. Organization handling

- PATCH org: `name`, `companyName` only. Slug is not writable.
- Org id always from JWT.
- Django SUPER_ADMIN remains **JWT-org-scoped** (stricter than Next flag-off SUPER_ADMIN PATCH user lookup, which may omit org filter). Global SUPER_ADMIN user writes across orgs are **not** implemented in Django. Do not weaken isolation.
- Org create/delete: NOT PRESENT.

---

## 8. Department handling

- Create/rename scoped to JWT org. Unique `(organizationId, name)`.
- Delete blocked if any users or jobs (`400` existing message).
- Cross-org id → **404**.

---

## 9. RBAC matrix

| Actor | Create user | Patch user (name/active/dept) | Change role | Dept CRUD | Patch org |
|---|---|---|---|---|---|
| SUPER_ADMIN | yes (own JWT org in Django) | yes (own JWT org) | yes | yes | yes |
| HR_ADMIN | yes (not SUPER_ADMIN targets) | yes | **403** | yes | yes |
| RECRUITER | **403** | **403** | **403** | **403** | **403** |
| HIRING_MANAGER | **403** | **403** | **403** | **403** | **403** |
| INTERVIEWER | **403** | **403** | **403** | **403** | **403** |
| CANDIDATE | **403** | **403** | **403** | **403** | **403** |
| missing/invalid/expired JWT | **401** | **401** | **401** | **401** | **401** |
| other org | **404** on PATCH by id | **404** | **404** | **404** | JWT org only |

Same-org vs other-org: other-org user/dept ids return **404**, not **403**.

---

## 10. Organization isolation

Never trust browser `organizationId`. BFF drops it. Django `require_organization_id` uses the principal. Extra keys including `organizationId` → **400** `Unsupported fields`.

---

## 11. Session / JWT behavior

Unchanged: `createSessionToken` claims (`sub`, email, name, role, organizationId), cookie name `aros_session`. Inactive staff: Next login **401**; Django JWT auth **401** if `isActive` is false. Existing sessions minted while active remain until expiry unless login is re-attempted (same as before).

---

## 12. Audit behavior

Next.js admin writes created **no** audit/timeline rows. Django does not invent an audit system. Passwords / hashes / JWT are not logged.

---

## 13. Transaction behavior

Create user is a single INSERT in `transaction.atomic()`. User PATCH uses `select_for_update` then `update`. Department create/rename/delete and org update are atomic. No partial user+hash rows.

---

## 14. Concurrency

Last-write-wins. No version column (none existed).

---

## 15. Idempotency / double-click

Create user is not idempotent; second submit with the same email → **409**. Department create with the same name → **400** (unique constraint). Activate/deactivate and role PATCH are last-write-wins.

---

## 16. Response parity

| Op | Success | Errors |
|---|---|---|
| POST user | **201** `{ user, temporaryPassword }` | 400 validation, 403, 409 email, 401 |
| PATCH user | **200** `{ user }` | 400 self-deactivate / validation, 403 role, 404 |
| POST dept | **201** `{ department }` | 400 |
| PATCH dept | **200** `{ department }` | 404 |
| DELETE dept | **200** `{ ok: true }` | 400 in-use, 404 |
| PATCH org | **200** `{ organization }` | 404 |

Django down + flag ON → **503** (no Prisma fallback).

---

## 17. Performance

Synchronous SQL. No Celery. Live `admin_write_parity` (TESTCASE user/dept only; org name restored):

Create includes bcrypt (~cost 12). Live `admin_write_parity` (n=5): **p50 7.2 ms**, **p95 211.1 ms** (create hash). Times: 5.8, 6.7, 7.2, 9.5, 211.1 ms.

---

## 18. UI test

TEST only: `admin@local.dev` on `/dashboard/admin` with flag ON.

- Created `4c3.ui.testcase@example.com` (temp password shown; hash not in JSON)
- Deactivate → Activate
- Role INTERVIEWER → RECRUITER
- Department create / rename / delete
- Org save (name unchanged: Logi Hiring)
- Production CEO/admin accounts were not modified beyond this TEST user (removed after)

Admin create form: `e.currentTarget.reset()` after `await` was null, so the list did not refresh. Fixed by capturing the form element before `await` (same for department create). Not a visual redesign.

---

## 19. Rollback

`NEXT_PUBLIC_USE_DJANGO_ADMIN_WRITES=false` (default) + restart Next.js → Prisma paths. Independent of READS / ASYNC / STAGE_WRITES / JOB_WRITES.

---

## 20. Regression

- `python manage.py check`
- Django test suite
- `node --test tests/unit/staff-admin-writes.test.ts`
- Login UI and `POST /api/auth/login` unchanged
- Interview / proctoring / AI / Prisma schema untouched

---

## 21. Known limitations

1. Django SUPER_ADMIN cannot patch users in another organization (stricter than Next flag-off).
2. Role changes do not rewrite `aros_session`; re-login required for JWT role.
3. No live password-reset API.
4. No user or organization deletion.
5. Admin GETs remain Next/Prisma.
6. Flag ON + Django down fails closed (503).
7. Prisma schema unmanaged in Django (`managed = False`). Do not `migrate` those tables.

---

## Django routes

| Method | Path |
|---|---|
| POST | `/api/v1/admin/users/` |
| PATCH | `/api/v1/admin/users/{id}/` |
| POST | `/api/v1/admin/departments/` |
| PATCH | `/api/v1/admin/departments/{id}/` |
| DELETE | `/api/v1/admin/departments/{id}/` |
| PATCH | `/api/v1/admin/org/` |

Permission: `IsAdminOrHR`. Auth: `HireOSJWTAuthentication`.
