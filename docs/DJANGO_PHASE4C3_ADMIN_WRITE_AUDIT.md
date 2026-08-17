# Logisoft HireOS — Phase 4C.3 audit (before implementation)

**Date:** 2026-08-16  
**Scope:** Existing Admin / User / Organization / Department **writes** only.

---

## 1. Mutations that actually exist

Staff admin UI: `src/app/dashboard/admin/page.tsx` → `AdminConsole` (`requireAdmin` / `canAdministerUsers`: **SUPER_ADMIN, HR_ADMIN**). Recruiters redirected.

| Operation | Endpoint | Method | Present |
|---|---|---|---|
| List staff users | `GET /api/admin/users` | GET | Read — **not a write** |
| Create staff user | `POST /api/admin/users` | POST | **YES** |
| Edit user (name, dept, active, role) | `PATCH /api/admin/users/:id` | PATCH | **YES** |
| List departments | `GET /api/admin/departments` | GET | Read |
| Create department | `POST /api/admin/departments` | POST | **YES** |
| Rename department | `PATCH /api/admin/departments/:id` | PATCH | **YES** |
| Delete department | `DELETE /api/admin/departments/:id` | DELETE | **YES** (blocked if users/jobs) |
| Get org settings | `GET /api/admin/org` | GET | Read |
| Update org name/companyName | `PATCH /api/admin/org` | PATCH | **YES** |
| Staff org+depts for job form | `GET /api/org` | GET | Read |

**NOT PRESENT**

| Operation | Status |
|---|---|
| DELETE user | NOT PRESENT |
| Password reset / change password | NOT PRESENT (login only verifies bcrypt) |
| Change user organizationId | NOT PRESENT |
| Change user email | NOT PRESENT |
| Create/delete Organization | NOT PRESENT |
| Duplicate user | NOT PRESENT |
| Audit/timeline for admin actions | NOT PRESENT |

**KEEP NEXT.JS (not admin writes)**

| Path | Why |
|---|---|
| `POST /api/auth/login` | Cookie JWT source of truth |
| `POST /api/auth/register` | Public candidate/org signup |
| `POST /api/careers/apply` | May create CANDIDATE user |
| All GETs above | Reads; 4C.3 is writes |

---

## 2. Prisma (verified)

**Organization:** id, name, slug unique, companyName default `""`, createdAt, updatedAt.

**Department:** id, organizationId, name, timestamps. `@@unique([organizationId, name])`. Jobs/users SetNull on department delete.

**User:** id, email unique, **passwordHash**, name, role (Role enum), isActive default true, organizationId?, departmentId?, timestamps. Indexes role, organizationId. Job `createdBy` has **no onDelete cascade** (restrict).

**Role enum:** SUPER_ADMIN, HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER, CANDIDATE.

---

## 3. Create user contract

`POST /api/admin/users`  
Auth: `requireAdmin`. Body: `{ name min1 max120, email, role in staff roles, departmentId?, organizationId? }`.

- HR_ADMIN cannot create SUPER_ADMIN → **403** `"Only Super Admin can create Super Admin users"`.
- Org: `requireOrganizationId(actor, body.organizationId)` (SUPER_ADMIN may pass org).
- Duplicate email → **409** `"Email already in use"`.
- Department must be in org → **400** `"Department not found"`.
- Temp password: `randomBytes(9).toString("base64url").slice(0, 12)`.
- Hash: **bcryptjs.hash(temp, 12)**.
- `isActive: true`. Never CANDIDATE via this API.
- **201** `{ user: { id, name, email, role, isActive, departmentId, department }, temporaryPassword }`.
- passwordHash never in JSON.

UI does not send organizationId.

---

## 4. Patch user contract

`PATCH /api/admin/users/:id`  
Body optional: `isActive`, `role` (staff enum), `departmentId` nullable, `name` min1 max120.

- Role change: **only SUPER_ADMIN** else **403** `"Only Super Admin can change roles"`.
- Target: staff only (`role not CANDIDATE`), org-scoped except SUPER_ADMIN unscoped find.
- Missing → **404** `"User not found"`.
- Cannot set `isActive: false` on self → **400** `"Cannot deactivate your own account"`.
- **PATCH does not re-validate department org** (weakness). Django **will** validate.
- **200** `{ user }` same select as create (no temp password).
- JWT role is minted at **login**. Changing role in DB does **not** update `aros_session` until next login. Do not invent live JWT refresh.

---

## 5. Department / org writes

**POST dept:** `{ name max120 }` trim, org from actor (+ optional organizationId for SUPER_ADMIN). **201** `{ department }`.

**PATCH dept:** `{ name }` trim. SUPER_ADMIN unscoped by id. **200** `{ department }`. Missing **404**.

**DELETE dept:** if users or jobs > 0 → **400** `"Department still has users or jobs — reassign first"`. Else **200** `{ ok: true }`.

**PATCH org:** `{ name?, companyName? }` trim, org via `requireOrganizationId(user, body.organizationId)`. **200** `{ organization: { id, name, slug, companyName } }`. No slug write. No org delete.

---

## 6. Password / session

- Login: bcrypt.compare against `passwordHash`; inactive → same 401 as bad password.
- Django directory already 401s inactive staff.
- No password change API. Create returns plaintext temp **once** (existing product). Django must use **bcrypt cost 12**, never log it, never persist plaintext, never put hash in responses.
- No session invalidation on deactivate (existing). Next login then fails. Django APIs fail if `HIREOS_ENFORCE_PRISMA_USER_STATUS`.

---

## 7. Django isolation vs Next SUPER_ADMIN

Next SUPER_ADMIN may pass `organizationId` and patch users/depts across orgs. Django staff APIs stay **JWT-org-scoped**. BFF strips `organizationId`. Cross-org → **404**. Do not weaken.

---

## 8. Side effects

No timeline, no email, no Celery, no Ollama, no `revalidatePath`. UI: toast + refetch lists.

Concurrency: last write wins. Create user not idempotent (unique email 409 on duplicate).

---

## 9. Feature flag

`NEXT_PUBLIC_USE_DJANGO_ADMIN_WRITES=false` (independent).
