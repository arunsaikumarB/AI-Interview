# HireOS V3.1 — Fresh-server database deployment

Status: procedure rehearsed end-to-end on a disposable, empty `pgvector/pgvector:pg16` database on 2026-09-30 (evidence in section 19).
Applies to: the repository as of HireOS V3.1 (Prisma 5.22.0, PostgreSQL 16 + pgvector).

---

## 1. Purpose

This document is the **only** supported way to build the HireOS V3.1 database schema on a **new, empty** PostgreSQL database (for example the company UAT server).

It produces a schema that is structurally identical to the verified development schema for every V3/V3.1 object, including the database-level `PracticalSubmission_immutable` trigger that Prisma cannot create by itself.

## 2. Important R-4 warning

> **R-4 (migration baseline) is open and intentionally unchanged.**
>
> - `prisma/migrations/` does **not** describe the current schema. `20260812000000_init` builds an older, different schema, and later migrations alter tables (`Organization`, `Candidate`, …) that no migration creates.
> - There is no `_prisma_migrations` ledger in the development database.
> - Therefore **`prisma migrate deploy` is NOT the deployment procedure for this repository** (see section 17). Do not run it, and do not run `prisma migrate resolve` or `prisma migrate reset`.
> - This procedure does not create, repair, baseline or otherwise touch the migration ledger (see section 18).

## 3. Prerequisites

| Requirement | Detail |
|---|---|
| PostgreSQL | 16 (rehearsed on 16.14). **14 or newer is mandatory**: the trigger file uses `CREATE OR REPLACE TRIGGER`. |
| pgvector | Installed on the server (the `pgvector/pgvector:pg16` image includes it; rehearsed with 0.8.x). The schema declares `extensions = [vector]`, so `prisma db push` runs `CREATE EXTENSION vector`. If the application role is not allowed to create extensions, a superuser must run `CREATE EXTENSION IF NOT EXISTS vector;` in the target database first (the same statement as `docker/postgres/init.sql`). |
| Database role | Owns the (empty) target database, or has `CREATE` on schema `public`. |
| Node.js / npm | Node 24.x was used for verification; npm 11. |
| Repository | The release commit, checked out on the machine that will run the commands. |
| Prisma CLI | **Exactly 5.22.0**, from the repository's `devDependencies` (see step P2). |
| `psql` | Any PostgreSQL client, only for the read-only verification in section 7. `docker exec <postgres-container> psql …` works too. |
| `DATABASE_URL` | Points at the **new, empty** database, e.g. `postgresql://<user>:<password>@<host>:<port>/<database>?schema=public`. |

## 4. Fresh empty database requirement

This procedure is valid **only** when the target database contains no tables in schema `public`.

Check before starting (read-only):

```sql
SELECT count(*) AS public_tables FROM pg_tables WHERE schemaname = 'public';
```

The result **must be `0`**. If it is not `0`, **stop**: this procedure does not apply. Never "make it empty" by dropping objects without an approved plan and a verified backup.

---

## LOCAL DEVELOPMENT vs FRESH PRODUCTION DATABASE

| | Local development | Fresh production / UAT database |
|---|---|---|
| Database | Developer's Docker Postgres (`localhost:55432`, `ai_recruitment_os`) — contains CEO demo data and unrelated `Orchestrator*` drift | New, empty database on the company server |
| Schema tool | Already built. **Do not** run `prisma db push`, `migrate deploy`, `migrate reset` or any SQL from this document against it | Section 5 below |
| Seed | Developer's choice | Not part of this procedure (seed creates `password123` demo accounts; see the release checklist) |
| Verification | The read-only script in section 7 may be run (it was: 14/14 PASS) | Section 7 — mandatory |

---

## 5. Exact Prisma command sequence (fresh production database)

Run from the repository root, with `DATABASE_URL` set to the **new, empty** database.
Prisma does not override a `DATABASE_URL` that is already set in the environment, so an exported value takes precedence over any `.env` file. Prisma prints the target database and host on every command — **read it before continuing**.

**P1. Install dependencies (also runs `prisma generate` via the `postinstall` script)**

```bash
npm ci
```

Do **not** run it with `NODE_ENV=production` or `--omit=dev`: the Prisma CLI is a devDependency.

Create the repository-root `.env` **before** this step. `prisma generate` records whether a `.env` exists; if it does not, the generated client never reads `.env`, and `npm run bootstrap:admin` (P7) then needs `DATABASE_URL` exported in the shell. The Prisma CLI steps below and `next build`/`next start` read `.env` themselves and are not affected.

**P2. Confirm the pinned Prisma CLI**

```bash
npx prisma --version
```

Both `prisma` and `@prisma/client` **must** show `5.22.0`. If not, stop (a different major version would apply different rules).

**P3. Confirm the database is empty** — run the section 4 query. It must return `0`.

**P4. Create the schema from `prisma/schema.prisma`**

```bash
npx prisma db push --skip-generate
```

- On an empty database this only creates objects (extension, enums, tables, indexes, foreign keys). Expected output ends with `Your database is now in sync with your Prisma schema.`
- **Never** add `--accept-data-loss` or `--force-reset`. If Prisma warns about data loss, the database was not empty — stop.
- `--skip-generate` is used because P1 already generated the client (this is also what `docker/app/entrypoint.sh` does).

**P5. Add the database-level integrity trigger** (section 6)

```bash
npx prisma db execute --file prisma/manual/20260930_v3_production_trigger.sql --schema prisma/schema.prisma
```

Expected output: `Script executed successfully.`

**P6. Verify** — section 7. All 14 checks must be `PASS`.

That is the complete schema procedure. Do not run any other file from `prisma/manual/` on a fresh database.

**P7. Create the first organization and SUPER_ADMIN** (one-time, interactive) — see [DEPLOYMENT-BOOTSTRAP-ADMIN.md](DEPLOYMENT-BOOTSTRAP-ADMIN.md):

```bash
npm run bootstrap:admin
```

Never use `prisma/seed.ts` for this.

## 6. Exact SQL required after `db push`

**File:** `prisma/manual/20260930_v3_production_trigger.sql`

`prisma db push` already creates every V3/V3.1 enum, table, column, default, unique index, index and foreign key, with the same names and definitions as the manual SQL (rehearsal: identical, section 19). The **only** V3/V3.1 database objects Prisma cannot express are:

| Object | Kind | Purpose |
|---|---|---|
| `practical_submission_immutable()` | PL/pgSQL function | Rejects any change to frozen submission fields (`assessmentId`, `language`, `source`, `sourceSha256`, `sizeBytes`, `taskVersion`, `submittedAt`), and rejects any update once a result is recorded (`execStatus` in `COMPLETED`, `EXECUTION_FAILED`, `TIMEOUT`). |
| `PracticalSubmission_immutable` | `BEFORE UPDATE … FOR EACH ROW` trigger on `"PracticalSubmission"` | Calls the function above. |

The file contains exactly these two objects inside one transaction. Their text is identical to lines 66–88 of `prisma/manual/20260929_v3_practical_assessment.sql`, except `CREATE` → `CREATE OR REPLACE`, so that:

- it never creates an enum, table, index or constraint (no duplicates with `db push`);
- re-running it is harmless and still leaves exactly one trigger (rehearsed: run twice, 1 trigger);
- it drops nothing;
- if `"PracticalSubmission"` does not exist, it fails and the transaction changes nothing.

Why the original V3 manual file must **not** be used on a fresh database: its `CREATE TYPE "PracticalType"` (and the other enums and tables) already exist after `db push`, so the file fails at its first statement and its transaction rolls back — the trigger would never be created.

V3.1 (`CandidateAssessmentLink`) has **no** objects outside Prisma; `db push` creates it completely.

The HNSW index from `prisma/migrations/20260812010000_candidate_embedding_hnsw` is a talent-search performance index only. It is not part of this procedure and does not exist in the development database either.

## 7. Verification (read-only)

**Single script:** `prisma/manual/20260930_v31_verify_readonly.sql`. It runs inside `BEGIN READ ONLY … ROLLBACK` and prints one `PASS`/`FAIL` row per check.

`psql` does not accept Prisma's `?schema=public` suffix, so pass the URL without it:

```bash
psql "postgresql://<user>:<password>@<host>:<port>/<database>" -v ON_ERROR_STOP=1 -f prisma/manual/20260930_v31_verify_readonly.sql
```

Or through the Postgres container:

```bash
# bash
docker exec -i <postgres-container> psql -U <user> -d <database> -v ON_ERROR_STOP=1 -f - < prisma/manual/20260930_v31_verify_readonly.sql
```

```powershell
# PowerShell
Get-Content prisma/manual/20260930_v31_verify_readonly.sql -Raw | docker exec -i <postgres-container> psql -U <user> -d <database> -v ON_ERROR_STOP=1 -f -
```

**Expected result: 14 rows, all `PASS`.**

| # | Check |
|---|---|
| 1 | extension `vector` installed |
| 2 | table `PracticalAssessment` exists |
| 3 | table `PracticalSubmission` exists |
| 4 | table `CandidateAssessmentLink` exists |
| 5 | enum `PracticalType` = `CODING, SQL` |
| 6 | enum `PracticalStatus` has all 9 values in order |
| 7 | enum `PracticalExecStatus` has all 5 values in order |
| 8 | function `practical_submission_immutable()` exists |
| 9 | trigger `PracticalSubmission_immutable` exists: `BEFORE UPDATE FOR EACH ROW`, enabled, on `PracticalSubmission`, calling that function |
| 10–13 | unique indexes: `PracticalAssessment_accessTokenHash_key`, `PracticalSubmission_assessmentId_key`, `CandidateAssessmentLink_applicationId_key`, `CandidateAssessmentLink_accessTokenHash_key` |
| 14 | the five V3/V3.1 foreign keys exist |

If checks 8 and 9 are the only `FAIL`s, step P5 was skipped — run it. Any other `FAIL` means P4 did not complete; stop and investigate.

The individual queries below are equivalent, for engineers who prefer to check one item at a time (all read-only).

## 8. Verify `PracticalSubmission_immutable` exists

```sql
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'practical_submission_immutable';

SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgname = 'PracticalSubmission_immutable' AND NOT tgisinternal;
```

Expected: one function row; one trigger row with `tgenabled = O` and definition
`CREATE TRIGGER "PracticalSubmission_immutable" BEFORE UPDATE ON public."PracticalSubmission" FOR EACH ROW EXECUTE FUNCTION practical_submission_immutable()`.

## 9. Verify required PostgreSQL extension(s)

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

Expected: one row (`vector`). `plpgsql` (used by the trigger function) is built into PostgreSQL and always present.

## 10. Verify `CandidateAssessmentLink` exists

```sql
SELECT to_regclass('public."CandidateAssessmentLink"') AS candidate_assessment_link;
```

Expected: `"CandidateAssessmentLink"` (not empty/NULL).

## 11. Verify `PracticalAssessment` exists

```sql
SELECT to_regclass('public."PracticalAssessment"') AS practical_assessment;
```

Expected: `"PracticalAssessment"`.

## 12. Verify `PracticalSubmission` exists

```sql
SELECT to_regclass('public."PracticalSubmission"') AS practical_submission;
```

Expected: `"PracticalSubmission"`.

## 13. Verify the three V3 enums exist

```sql
SELECT t.typname, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS labels
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typname IN ('PracticalType', 'PracticalStatus', 'PracticalExecStatus')
GROUP BY t.typname ORDER BY t.typname;
```

Expected:

| typname | labels |
|---|---|
| PracticalExecStatus | PENDING, EXECUTING, COMPLETED, EXECUTION_FAILED, TIMEOUT |
| PracticalStatus | NOT_STARTED, STARTED, IN_PROGRESS, SUBMITTED, EXECUTING, COMPLETED, EXECUTION_FAILED, TIMEOUT, CANCELLED |
| PracticalType | CODING, SQL |

---

## 14. Backup procedure before deployment

On a brand-new database there is nothing to lose, but take the backups anyway so that the "before" state is recorded and the same habit applies to every later deployment. These are standard PostgreSQL client tools, not repository scripts.

1. Record the target and confirm it is the new database (Prisma prints it on every command; section 4 must return `0`).
2. Database backup (custom format):

   ```bash
   pg_dump --format=custom --no-owner --file=hireos_pre_deploy_$(date +%Y%m%d_%H%M%S).dump "postgresql://<user>:<password>@<host>:<port>/<database>"
   ```

3. After the procedure (and again before UAT data arrives), take a second dump the same way. This is the restore point for rollback.
4. Once the application is running, back up the storage directory (`STORAGE_ROOT`, which holds resumes and recordings) together with each database dump — the database references those files.
5. Store backups off the database server, and test a restore into a scratch database before relying on them.

## 15. Rollback procedure

Every rollback below is destructive for the **new** database only and requires explicit approval from the release owner. None of them touches R-4 or the development database.

| Situation | Rollback |
|---|---|
| P4 or P5 failed on the fresh database | The database held nothing before P4. Fix the cause, have the DBA discard and recreate the **new** empty database, then restart from P1. No other database is involved. |
| Only P5 (trigger) needs to be re-applied | Re-run P5. It is safe to repeat. **Do not remove the trigger on its own** — that disables a V3 integrity guarantee while the application still relies on it. |
| Deployed, UAT data exists, release must be undone | Stop the application, restore the post-procedure / pre-UAT dump from section 14 into the database (`pg_restore --clean --if-exists --no-owner -d <database> <file>.dump`), restore the matching storage backup, redeploy the previous application build. |
| Remove only the V3/V3.1 objects | Existing files: `prisma/manual/20260929_v31_candidate_assessment_link_rollback.sql`, then `prisma/manual/20260929_v3_practical_assessment_rollback.sql` (the V3 file also drops the trigger and function). They **delete all practical-assessment and hub-link data**, and the current application build will fail without those tables, so use them only together with a rollback to a pre-V3 application build. Apply with `npx prisma db execute --file <file> --schema prisma/schema.prisma`. |

## 16. This procedure must NOT be run against the existing development database

> **Do not run any step of section 5 against the development database** (`ai_recruitment_os` on `localhost:55432`, or any database that already contains HireOS tables).
>
> - The development database is not empty. It holds intentional CEO demo data, already has every V3/V3.1 object (including the trigger), and contains unrelated `Orchestrator*` tables and a `Job.automationConfig` column that are not in `schema.prisma`.
> - `prisma db push` against it would propose **dropping** those foreign tables and column (data loss).
> - Nothing in this document is needed there: the read-only verification (section 7) already reports 14/14 `PASS` on it.
> - Do not build a production schema by dumping the development database: the dump would carry the `Orchestrator*` drift and demo data.

## 17. `prisma migrate deploy` is NOT the deployment procedure

> For the current repository, **`prisma migrate deploy` must not be used** — not on a fresh server and not on an existing one. The migration history does not represent `schema.prisma` (section 2); applying it would fail part-way (the second migration indexes a `"Candidate"` table that the first migration never creates) or leave an obsolete schema.
>
> The Docker image does not use it either: `docker/app/entrypoint.sh` runs `prisma db push` only when the database is empty and never runs `migrate deploy`. If the Docker `app` container bootstraps an empty database this way, **step P5 is still required** afterwards, because the entrypoint does not create the trigger. From inside the container (not rehearsed):
>
> ```bash
> docker compose exec app node ./node_modules/prisma/build/index.js db execute --file prisma/manual/20260930_v3_production_trigger.sql --schema prisma/schema.prisma
> ```

## 18. R-4 is intentionally not changed

This procedure:

- does **not** modify `prisma/schema.prisma` or any file in `prisma/migrations/`;
- does **not** create a migration, a `_prisma_migrations` table, or ledger rows;
- does **not** run `prisma migrate deploy`, `migrate resolve` or `migrate reset`;
- does **not** change the original manual SQL files.

Resolving R-4 (a true baseline migration) is a separate, explicitly approved task. Until then, every future schema change needs its own reviewed manual SQL file plus an update to this document.

---

## 19. Rehearsal evidence (2026-09-30)

Run against a **disposable** container (`pgvector/pgvector:pg16`, no volume, `127.0.0.1:55499`, throwaway credentials), removed afterwards. The development database was fingerprinted read-only before and after (25 tables, 17 enums, one trigger, no ledger, row counts unchanged).

| Step | Result |
|---|---|
| Empty check | `0` public tables |
| P4 `npx prisma db push --skip-generate` | `Your database is now in sync with your Prisma schema.` |
| Verification after P4 only | 12 PASS; checks 8 and 9 (function, trigger) FAIL — confirms the gap |
| P5 `npx prisma db execute --file prisma/manual/20260930_v3_production_trigger.sql …` | `Script executed successfully.` — run twice, still exactly 1 trigger |
| Verification after P5 | 14/14 PASS |
| `prisma migrate diff` (rehearsal DB → `schema.prisma`) | `-- This is an empty migration.` (no drift) |
| Structural comparison with the development database (columns, defaults, indexes, constraints, enum labels, function source hash, trigger definition of all V3/V3.1 objects) | 65/65 lines identical |
| Trigger behaviour (rehearsal DB only) | Changing `source` rejected (`frozen fields are immutable`); `PENDING → COMPLETED` allowed; overwriting the recorded result rejected (`result is already recorded`) |
