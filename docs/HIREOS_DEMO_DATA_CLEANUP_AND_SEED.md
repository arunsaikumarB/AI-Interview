# HireOS — demo data cleanup and professional seed

**Date:** 2026-08-17  
**Organization:** Logi Hiring (`slug: acme-hiring`, id `cmsp3appz00002ezwf1xu0oiu`)  
**Final status:** **DEMO READY**

This was a data-only operation. Prisma schema, authentication, JWT/`aros_session`, AI engine, interview/proctoring logic, and integrity hardening were not modified.

---

## 1. Records removed

Confirmed UAT / automated-test / operator-QA pollution (dependency-safe: applications first, which cascades sessions, questions, answers, proctoring, evaluations, timeline; then candidates, jobs, extra users). Recording folders were deleted only for those sessions.

| Category | Count | Why safe to remove |
|---|---|---|
| Applications | 23 | All prior pipeline rows, including UAT and seed-mixed applications |
| Interview sessions | 61 | UAT/STRICT/ENHANCED runs, cancelled duplicates, Taylor Testcase, uat-e2e |
| Proctoring events | 738 | Signals attached to those sessions only |
| AI evaluations | 138 | Attached to those applications/sessions |
| Candidates | 21 | Replaced by professional demo set (see retained vs removed below) |
| Jobs | 6 | Old seed + TEST + typo PM job + unused UI/UX job |
| Extra users | 5 | Test-only accounts (staff logins kept) |
| Secondary recording trees | 16 | Paths taken from `InterviewSession.secondaryRecordingPath` only |

**Extra users removed**

| Email | Why |
|---|---|
| `portal-1786508347386@example.com` | Timestamped portal UAT user |
| `temp-deact-1786508350082@local.dev` | Activation/deactivation test |
| `mallory.breach.1786509446400@example.com` | Isolation / Mallory UAT |
| `mallory.breach.1786509458477@example.com` | Isolation / Mallory UAT |
| `tomparkerofficial02@gmail.com` | Operator QA during interview/proctoring UAT (personal email; not a production hire) |

**Candidates / jobs treated as test (removed with the wipe)**

- `taylor.testcase@example.com`, `uat-e2e-*`, `phase9-*`, `apply-test-*`, `apply-pdf-*`
- `TEST — Senior Full Stack Engineer`
- `Product management Speclist` (typo QA job)
- Original seed names (Alex Ng, Blair Singh, …) — replaced so the CEO demo is not the old 10-person seed mix
- Operator Gmail QA: `tomparkerofficial02@gmail.com` (Arun Kumar), `dileepkumarkuppamiit5@gmail.com` (Deelip Kumar)

Those Gmail rows were **operator-created QA**, not production hiring records. They were removed so personal emails and UAT interview/proctoring history are not shown to CEO/HR.

---

## 2. Records retained

| Record | Status |
|---|---|
| Organization Logi Hiring / `acme-hiring` | Kept (not recreated) |
| `admin@local.dev` SUPER_ADMIN | Kept (password unchanged) |
| `hr@local.dev` HR_ADMIN | Kept |
| `recruiter@local.dev` RECRUITER | Kept |
| `hm@local.dev` HIRING_MANAGER | Kept |
| `interviewer@local.dev` INTERVIEWER | Kept |
| `candidate@local.dev` CANDIDATE portal | Kept; display name updated to **Meera Iyer** |
| Department Engineering | Kept |
| Department People | Kept (used as HR department; not duplicated as “Human Resources”) |
| Email templates | Kept |
| Password hashing / login / JWT | Untouched |

---

## 3. Demo jobs created (6, all OPEN)

| Title | Department | Experience | Location |
|---|---|---|---|
| Senior Full Stack Engineer | Engineering | 5–8 | Hyderabad / Hybrid |
| Frontend React Developer | Engineering | 3–5 | Bengaluru / Hybrid |
| Product Designer (UI/UX) | Design | 3–6 | Remote / Hybrid |
| Product Manager | Product | 4–7 | Hyderabad / Hybrid |
| HR Business Partner | People | 4–7 | Hyderabad |
| Sales Account Executive | Sales | 3–6 | Mumbai / Hybrid |

Departments **Product**, **Design**, and **Sales** were created (they did not exist). **People** already existed.

---

## 4. Demo candidates created (14)

Synthetic emails on `@logihiring.example` except the portal account.

Meera Iyer, Arjun Mehta, Priya Sharma, Daniel Wilson, Ananya Rao, Michael Carter, Sneha Reddy, Rahul Verma, Emily Johnson, Karthik Nair, Olivia Bennett, Vikram Singh, Sarah Mitchell, Neha Kapoor.

Portal login remains `candidate@local.dev` / `password123` (Meera Iyer).

---

## 5. Demo applications created (18)

Stage histogram (matches `GET /api/applications/pipeline-counts`):

| Stage | Count |
|---|---|
| APPLIED | 4 |
| SCREENING | 3 |
| SHORTLISTED | 2 |
| ASSESSMENT | 1 |
| AI_INTERVIEW | 2 |
| TECH_INTERVIEW | 1 |
| HR_INTERVIEW | 1 |
| SELECTED | 2 |
| REJECTED | 2 |

Each application has `APPLICATION_CREATED` timeline; non-APPLIED rows also have `STAGE_CHANGED`; SELECTED/REJECTED have `DECISION`.

---

## 6. Interview sessions created (6)

| Status | Candidate | Role | Questions / answers | Proctoring |
|---|---|---|---|---|
| COMPLETED | Arjun Mehta | Senior Full Stack Engineer | 6 / 6 | OFF |
| COMPLETED | Daniel Wilson | Frontend React Developer | 6 / 6 | OFF |
| COMPLETED | Ananya Rao | Product Designer | 6 / 6 | OFF |
| IN_PROGRESS | Sarah Mitchell | Senior Full Stack Engineer | 3 / 1 | OFF |
| IN_PROGRESS | Priya Sharma | Frontend React Developer | 2 / 1 | OFF |
| SCHEDULED | Sneha Reddy | Product Manager | 0 / 0 | OFF |

Integrity mode STANDARD. No UAT warnings, no Device Interaction events, no fake recordings.

---

## 7. Interview questions created

23 questions (role-appropriate: architecture, APIs, research, metrics, employee relations, discovery, etc.). Scheduled session has a plan JSON and no questions yet (matches real “upcoming” links).

---

## 8. AI evaluations

Three `INTERVIEW_OVERALL` rows, model **`demo-seed`** (advisory; recruiter decides):

| Candidate | Overall | Recommendation |
|---|---|---|
| Arjun Mehta | 86 | YES |
| Daniel Wilson | 71 | MAYBE |
| Ananya Rao | 54 | NO |

These were **not** live Ollama runs. The UI should show them as stored evaluations with reasoning. Do not present them as a fresh model call.

---

## 9. Recording / proctoring

No new recordings. No new proctoring events. Prior UAT recording directories under `storage/interviews/<sessionId>/` for deleted sessions were removed. The rest of `storage/` was left intact.

---

## 10. Database integrity checks

| Check | Result |
|---|---|
| Orphan applications / sessions / answers / evals / timeline / proctoring | 0 |
| Stage counts sum vs application count | 18 = 18 |
| Jobs titled TEST | 0 |
| Candidates matching uat/testcase | 0 |
| Staff accounts remaining | 6 required logins |
| `prisma/schema.prisma` diff | unchanged |
| Destructive migrate / db push | not run |

---

## 11. Demo UI verification

Authenticated as `admin@local.dev` against running Next.js:

- `POST /api/auth/login` 200  
- `GET /api/auth/me` SUPER_ADMIN  
- `GET /api/jobs` 6 professional titles, no TEST/UAT  
- `GET /api/candidates` 14 professional names  
- `GET /api/applications` 18  
- `GET /api/applications/pipeline-counts` matches DB  
- `GET /api/health` database + ollama ok  

Candidate list does not expose `passwordHash` or JWT.

---

## 12. Warnings / issues

1. **People vs Human Resources:** existing department is named People; HR Business Partner is filed there to avoid a duplicate HR department.
2. **AI evaluations** are seeded (`demo-seed`), not generated by Ollama during this task.
3. **David Anderson** from the requested name list was not used (14 candidates already in range).
4. Operator Gmail QA accounts were removed; they will not appear in the demo.
5. Re-running `scripts/demo-cleanup-and-seed.mjs` will wipe **all** jobs/candidates/applications again (staff/org kept).

---

## 13. Commands used

```
node --env-file=.env scripts/_demo_inventory.mjs
node --env-file=.env scripts/demo-cleanup-and-seed.mjs
node --env-file=.env scripts/_demo_integrity.mjs
node scripts/_demo_api_verify.mjs
```

No `prisma migrate reset`, `prisma db push --accept-data-loss`, `DROP DATABASE`, or table-wide TRUNCATE.

---

## 14. Demo readiness

**DEMO READY**

Staff logins (password `password123`):

- CEO: `admin@local.dev`  
- HR: `hr@local.dev`  
- Manager: `hm@local.dev`  
- Recruiter: `recruiter@local.dev`  

App: http://localhost:3000/login  
Office LAN: http://192.168.88.33:3000/login  
CEO outside the office: screen share (no public URL).
