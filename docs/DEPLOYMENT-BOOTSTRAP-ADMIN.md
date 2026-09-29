# HireOS V3.1 — First organization and SUPER_ADMIN (bootstrap)

A **one-time operator action** on a **fresh production database**, run directly on the server:

```bash
npm run bootstrap:admin
```

It creates exactly one `Organization` and one `SUPER_ADMIN` user, and nothing else.

---

## 1. Why bootstrap is required

A database built with [DEPLOYMENT-DATABASE-V3.1.md](DEPLOYMENT-DATABASE-V3.1.md) has the schema but no rows. Without an organization and an administrator nobody can sign in:

- public registration (`/api/auth/register`) only creates **candidate** accounts, and refuses with `503` until an organization exists;
- staff accounts can only be created by an existing admin (`/dashboard/admin`);
- `prisma/seed.ts` does create an organization and admin, but it also creates demo accounts with the shared password `password123` plus demo jobs, candidates and applications — it must never be used in production (section 12).

`npm run bootstrap:admin` is the only supported way to create the first administrator.

## 2. Prerequisites

- The release is checked out on the server (GitLab `fe` branch at the release SHA) and `npm ci` has been run with devDependencies — the same prerequisite as the database procedure (the command uses `tsx`, a devDependency).
- The database was built and verified with [DEPLOYMENT-DATABASE-V3.1.md](DEPLOYMENT-DATABASE-V3.1.md) (steps P1–P6, 14/14 `PASS`).
- `DATABASE_URL` points at that database (see section 5).
- An **interactive terminal** on the server (a normal SSH session is fine). The command refuses piped input.
- Run it from the repository checkout on the host. The Docker `app` image does not contain `tsx` or `scripts/`, so it cannot run there.

## 3. When to run it

Once, immediately after database verification (step P7 of [DEPLOYMENT-DATABASE-V3.1.md](DEPLOYMENT-DATABASE-V3.1.md)) and before HR is given access. It is never run automatically: not by `npm install`/`npm ci`, `npm run build`, `npm run start`, the Docker entrypoint, `prisma db push`, migrations or the seed.

## 4. Exact command

From the repository root:

```bash
npm run bootstrap:admin
```

The command:

1. refuses to run without an interactive terminal;
2. connects using `DATABASE_URL` and prints the target database name, host and port (never credentials);
3. refuses immediately, before asking for anything, if the database is not fresh (section 10);
4. asks for the organization name, admin full name, admin email, and the password twice (password input is hidden);
5. validates everything and shows exactly what it will create;
6. asks you to **type the database name** to confirm;
7. creates the organization and the admin in one transaction and prints their IDs.

Exit code `0` means both records were created; any other outcome exits `1` and creates nothing. `Ctrl+C` at any prompt cancels without changes.

## 5. Required environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | The production database. Read from the environment, or from the repository-root `.env` (an exported value takes precedence). |

Nothing else. There is deliberately **no** bootstrap secret, **no** password variable and **no** `NEXT_PUBLIC_*` setting — the password is only ever typed at the hidden prompt. `NODE_ENV` is not used as the safety gate; the gates are the interactive terminal, the typed database-name confirmation and the fresh-database refusal.

## 6. Password requirements

- at least 12 characters, at most 72 bytes (bcrypt ignores anything longer, so longer passwords are rejected rather than silently truncated);
- at least one lowercase letter, one uppercase letter, one digit and one symbol;
- must not contain the word `password` or the part of the email before `@`;
- no control characters;
- typed twice; the two entries must match.

The password is hashed with bcrypt (cost 12) — the same library and cost used by registration and admin user creation, and verified by the normal login route. It is never printed, logged or stored in plain text.

## 7. What it creates

| Record | Fields |
|---|---|
| 1 × `Organization` | `name` and `companyName` = the organization name you enter; `slug` derived from it (lowercase letters, digits and dashes) |
| 1 × `User` | `role = SUPER_ADMIN`, `email` (stored lowercase), `name`, bcrypt `passwordHash`, `organizationId` = the new organization, `isActive = true`, no department |

## 8. What it does NOT create

No departments, no other users, no jobs, candidates, applications, interviews, evaluations, timeline events, practical assessments, assessment links, email templates, tags, or any demo data. It does not modify any existing row.

HireOS has no general audit table (timeline events belong to applications), so the bootstrap record is the command's console output plus the `createdAt` timestamps of the two rows. **Keep the console output** with the deployment record.

## 9. How to verify success

1. The command ends with `[bootstrap:admin] Created:` and exit code `0`.
2. Read-only checks (`psql` needs the URL without `?schema=public`):

   ```sql
   SELECT id, name, slug, "createdAt" FROM "Organization";
   SELECT id, email, role, "isActive", "organizationId", "createdAt", left("passwordHash", 7) AS hash_prefix FROM "User";
   ```

   Expected: exactly one organization; exactly one user with `role = SUPER_ADMIN`, `isActive = t`, the organization's id, and a hash prefix of `$2a$12$` or `$2b$12$`.
3. Open `https://<host>/login` and sign in with the admin email and password. The admin area is at `/dashboard/admin`.

## 10. What happens if it is run twice

It refuses and changes nothing. Bootstrap is refused when **any** of these is true:

- an organization already exists;
- a `SUPER_ADMIN` already exists;
- any user account already exists.

The check runs once before any prompt, and again inside the creating transaction under a database lock, so two operators running it at the same time cannot create two organizations (one succeeds, the other is refused).

## 11. Creating the first HR / admin accounts

After signing in as the SUPER_ADMIN:

1. Go to `/dashboard/admin`.
2. Create the departments you need.
3. Create each HR / staff user (e.g. `HR_ADMIN`, `RECRUITER`) with the existing user-creation form. HireOS generates a random temporary password and shows it **once** — deliver it to the person through a secure channel.

Use the bootstrap SUPER_ADMIN only for administration. V3.1 has no self-service password change, so choose the bootstrap password carefully and store it in the organization's password manager.

## 12. Do NOT use `prisma/seed.ts` in production

> `prisma/seed.ts` (`npm run db:seed`, `RUN_SEED=true`, or the pilot setup scripts) creates demo accounts for every role with a shared password, plus demo jobs, candidates and applications. **Never run it against a production or HR UAT database.** Keep `RUN_SEED=false`.

## 13. Do NOT use `password123`

> Never create, keep or reuse any account with the password `password123` (the demo seed password). The bootstrap command rejects it.

## 14. One-time operator action

> `npm run bootstrap:admin` is run **once per new database**, by an operator, on the server. It is not an API, it has no HTTP endpoint, and nothing runs it automatically. After it succeeds, it refuses to run again on that database.
