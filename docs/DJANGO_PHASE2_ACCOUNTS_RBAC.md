# Logisoft HireOS — Django Phase 2: Accounts + RBAC

**Status:** Foundation complete. Next.js remains the login/session source of truth.  
**Date:** 2026-08-15

---

## 1. Existing Next.js authentication architecture

Inspected in-repo (not assumed):

| Piece | Location | Exact behavior |
|---|---|---|
| User table | `prisma/schema.prisma` `model User` | `id` cuid PK, `email` unique, `passwordHash`, `name`, `role` (`Role` enum), `isActive`, `organizationId?`, `departmentId?`, timestamps |
| Role enum | `enum Role` | **`SUPER_ADMIN`, `HR_ADMIN`, `RECRUITER`, `HIRING_MANAGER`, `INTERVIEWER`, `CANDIDATE`** — not `ADMIN`/`HR` |
| Organization | `model Organization` | `id` cuid, `name`, `slug` unique, `companyName`, timestamps; `User.organizationId` optional FK |
| Password | `POST /api/auth/login` | `bcrypt.compare` vs `passwordHash`; inactive user → same 401 as bad password |
| JWT mint | `src/lib/auth/session.ts` `createSessionToken` | `jose` `SignJWT`, **HS256**, subject = user id |
| Claims | same | `email`, `name`, `role`, `organizationId` + standard `sub`, `iat`, `exp` |
| Secret | `AUTH_SECRET` | `TextEncoder.encode` UTF-8 bytes (same as HMAC-SHA256 of the string) |
| TTL | `AUTH_TOKEN_TTL_HOURS` default **12** | `setExpirationTime(\`${ttlHours()}h\`)` |
| Cookie | `AUTH_COOKIE_NAME` default **`aros_session`** | httpOnly, SameSite=Lax, path `/`, `secure` only in production |
| Session read | `getSession()` | Verifies JWT only — **does not re-read role from DB** |
| `/api/auth/me` | `src/app/api/auth/me/route.ts` | JWT then Prisma `findUnique`; inactive/missing → 401 |
| Middleware | `src/middleware.ts` | `jwtVerify`; sets `x-user-id/role/email`; Candidate vs staff path split |
| RBAC helpers | `src/lib/auth/rbac.ts` | `requireStaff`, `requireAdmin` (SUPER_ADMIN+HR_ADMIN), `requireOrganizationId` (SUPER_ADMIN may pass `?organizationId=`), `orgScopeWhere` (SUPER_ADMIN unscoped `{}`) |
| Seed users | `prisma/seed.ts` | `admin@local.dev` SUPER_ADMIN, `hr@local.dev` HR_ADMIN, recruiter/hm/interviewer/candidate `@local.dev` on org slug `acme-hiring` |

Phase 2 **did not modify** any of the above.

---

## 2. Django authentication strategy

**Decision: Django can safely validate the existing token.** No format change.

| Item | Value |
|---|---|
| Algorithm | HS256 only (`algorithms=["HS256"]`) |
| Key | `AUTH_SECRET` from repo-root `.env` (same as Next.js) |
| Accept | `Authorization: Bearer <jwt>` **or** cookie `aros_session` |
| Reject | wrong signature, expired `exp`, malformed compact JWT, unknown `role` |
| Does not use | `djangorestframework-simplejwt` issuing, Django `auth_user` passwords |

`jose` does not set `iss`/`aud`. Django does not require them.

Cookie sharing: browsers treat `localhost:3000` and `localhost:8000` as same-site (host without port). The existing cookie can be sent to Django on localhost without changing Next.js.

---

## 3. User identity mapping

Django does **not** create a second user table.

- External ID = Prisma `User.id` (`sub` claim).
- Unmanaged model `HireOSUser` (`managed = False`, `db_table = "User"`) is a read-only shape. **`passwordHash` is not on the model.**
- Optional directory `PrismaUserDirectory` runs  
  `SELECT id, email, role, "isActive", "organizationId" FROM "User" WHERE id = %s`  
  so `/me/` can reject inactive/missing users the same way Next `/api/auth/me` does.
- Tests use `TrustJwtDirectory` / fakes so they never write HireOS rows.

---

## 4. Organization mapping

- Unmanaged `Organization` model (`db_table = "Organization"`). **No org rows copied.**
- Scoping key = JWT `organizationId` (Prisma cuid string).
- `require_organization_id` / `org_scope_filter` / `assert_same_organization` in `apps/accounts/scoping.py`.
- Phase 2 is **stricter than Next.js SUPER_ADMIN**: there is **no global unscoped staff**. Every staff principal is locked to their JWT org. Passing another `organization_id` is **403**.

---

## 5. Role mapping

| JWT / Prisma | Django `HireOSRole` / `/me/.role` |
|---|---|
| SUPER_ADMIN | ADMIN |
| HR_ADMIN | HR |
| RECRUITER | RECRUITER |
| HIRING_MANAGER | HIRING_MANAGER |
| INTERVIEWER | INTERVIEWER |
| CANDIDATE | CANDIDATE |

Unknown JWT roles → 401.

---

## 6. Permission classes

`apps/accounts/permissions.py`

| Class | Allows |
|---|---|
| `IsAdmin` / `AdminOnly` | ADMIN |
| `IsHR` | HR |
| `IsRecruiter` | RECRUITER |
| `IsHiringManager` | HIRING_MANAGER |
| `IsInterviewer` | INTERVIEWER |
| `IsCandidate` | CANDIDATE |
| `StaffOnly` | all except CANDIDATE |
| `RecruitmentStaff` | ADMIN, HR, RECRUITER, HIRING_MANAGER (Next `canManagePipeline`) |
| `RecruiterOrHR` | HR, RECRUITER |
| `IsAdminOrHR` | ADMIN, HR (Next `requireAdmin`) |

Wrong role → **403**. Missing/invalid token → **401**.

---

## 7. `GET /api/v1/accounts/me/`

Authenticated only. JSON:

```json
{
  "external_user_id": "<prisma User.id>",
  "email": "...",
  "role": "RECRUITER",
  "organization_id": "<prisma Organization.id or null>"
}
```

Never returns password, `passwordHash`, `AUTH_SECRET`, or candidate PII beyond the session identity.

---

## 8. Security decisions

- Same HS256 secret as Next.js; no second signing key for HireOS sessions.
- Inactive Prisma users: 401 when `HIREOS_ENFORCE_PRISMA_USER_STATUS=true` (default).
- Staff org isolation enforced in Django even for ADMIN.
- Health endpoint remains unauthenticated.
- No Django login, register, password reset, or user admin.

---

## 9. Database changes

**None.** No `migrate`. No new tables.

| Object | Action |
|---|---|
| Prisma `"User"`, `"Organization"`, enums | Unchanged |
| Django `auth_*` / `django_*` | Not created in Phase 2 |
| Unmanaged models | ORM maps only; `managed = False` |

---

## 10. Tests

`python manage.py test apps.accounts --verbosity=2`

`SimpleTestCase` only — Django **does not** create a test database.

Coverage: valid user, invalid signature, expired, malformed, six roles + 403s, org A vs B, inactive directory, missing org, cookie auth.

Probe URLs exist only under `apps.accounts.tests.urls` (not production).

---

## 11. Migration risks

- JWT role lag vs DB (same as Next `getSession` on most routes). `/me/` optionally re-checks `isActive`.
- `SUPER_ADMIN` global org access is **not** replicated; future Jobs APIs must not assume Next.js `orgScopeWhere` empty filter.
- Cross-origin production (`app.example` vs `api.example`) would need explicit cookie `Domain` — **not changed**. Localhost ports share the cookie host.
- `makemigrations` on unmanaged models must never be applied as managed.

---

## 12. Future authentication migration plan

1. Keep Next.js login until Django has a dual-run period validating the **same** JWT.  
2. Optionally shorten TTL and re-read `User.role`/`isActive` on every Django request (already possible via directory).  
3. Only then move `POST /api/auth/login` to Django, still writing/reading Prisma `"User"`.  
4. Last: retire Next route handlers. Do not introduce `auth_user` as a second identity.

Interview magic-link tokens (`InterviewSession.accessToken`) are **out of scope** (not a User JWT).
