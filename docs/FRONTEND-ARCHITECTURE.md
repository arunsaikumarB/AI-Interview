# HireOS frontend: it is React

Short note for DevOps and reviewers who ask for "the frontend in React".

## Summary

The HireOS frontend **is** React (React 18). It runs on **Next.js 14.2** (App Router), the
standard React framework. Every page and UI component is an ordinary React component:

| Area | Count | Location |
|---|---|---|
| Pages (React) | 36 | `src/app/**/page.tsx` |
| UI components (React) | 93 | `src/components/**` |
| Server API routes | 96 | `src/app/api/**/route.ts` |

UI libraries are all React libraries: Tailwind, shadcn/ui, Zustand, TanStack Query.

## Why Next.js and not a plain React SPA (Vite / Create React App)

A plain React SPA runs only in the browser. In HireOS, Next.js is also the **server**:

- **API:** the 96 routes in `src/app/api` (`auth`, `jobs`, `candidates`, `applications`,
  `assessment`, `interview`, `practical`, `admin`, `org`, `talent`, `analytics`, ...) hold the
  business logic, role checks (RBAC), and organization scoping.
- **Auth:** HttpOnly session cookies are issued and verified on the server. Tokens are never
  exposed to browser JavaScript.
- **Security headers:** `src/middleware.ts` sets a per-request nonce-based CSP,
  `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, and Permissions-Policy, and redirects
  unauthenticated users.
- **Database:** all PostgreSQL access (Prisma) happens server-side.
- **Sandbox:** the server calls the code/SQL runner on `127.0.0.1:8010`, which is never exposed
  to browsers.

Converting to a plain React SPA would mean moving all of the above to another server (the Django
backend is not at feature parity; all `NEXT_PUBLIC_USE_DJANGO_*` flags are `false`), re-building
and re-verifying auth, RBAC, CSRF, cookies, CSP, and tenant isolation, and repeating full UAT.
That is a multi-week rewrite with no user-facing benefit, so it is not planned.

## What DevOps runs

One Node.js process per instance, behind the HTTPS reverse proxy:

```text
Browser --HTTPS :443--> reverse proxy --> Next.js (npm run start, Node) --> PostgreSQL 16 + pgvector
                                              |
                                              +--> sandbox runner 127.0.0.1:8010 --> Docker sandbox
```

- Build: `npm ci` then `npm run build` (`output: "standalone"`).
- Run: `npm run start -- -p <port>`. Do not use `npm run dev` in production.
- Only :443 is exposed by the host firewall. The app port and 8010 stay internal.

See `docs/DEPLOYMENT-DATABASE-V3.1.md` and `docs/DEPLOYMENT-BOOTSTRAP-ADMIN.md` for the full
deployment steps.
