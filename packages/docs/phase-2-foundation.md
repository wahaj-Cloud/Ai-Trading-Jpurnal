# Phase 2 — Foundation

## Purpose
A deployable, secure skeleton every later feature plugs into: sign-up/sign-in (email + Google),
a user record in our own database, plan assignment, profile settings, audit logging, the app shell,
the design system, and automated quality checks on every change.

## Architecture
```
Browser ──> Next.js web (Vercel) ──server-side fetch + session JWT──> NestJS API (Railway) ──> Postgres (Neon)
                  │                                                        ▲
                  └──── Clerk (identity) ──── signed webhooks ─────────────┘
```
- **Identity lives in Clerk; product data lives in our Postgres.** Users are linked by `auth_provider_id`.
  Two paths create the local user, both idempotent: the Clerk webhook and just-in-time provisioning on the
  first authenticated API call (covers webhook delay).
- **Every API route is private by default** (global guard). Public routes opt out with `@Public()`.
  The guard verifies JWT signature, expiry, and that it was issued for one of our web origins.
- **The browser never calls the API directly in this phase.** Pages fetch on the server, so the API address
  stays private and there is no token handling in browser JavaScript.
- **Validation schemas are shared** (`@atc/shared`): the web form and the API enforce the same rules.
- **Audit log is append-only in the database** (trigger), not just by convention.

## Files created
| Area | Path |
|---|---|
| Monorepo | `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `.nvmrc`, `packages/tsconfig/*` |
| Database | `packages/db/prisma/schema.prisma`, `prisma/migrations/20260926000000_foundation`, `prisma.config.ts`, `src/index.ts`, `src/seed.ts` |
| Shared | `packages/shared/src/{api-types,plans,settings}.ts` (+ tests) |
| API | `apps/api/src/{main,app.module}.ts`, `config/`, `prisma/`, `clerk/`, `auth/`, `users/`, `webhooks/`, `audit/`, `health/`, `common/` (+ tests), `railway.json` |
| Web | `apps/web/proxy.ts`, `app/` (landing, auth, dashboard, settings, error/loading), `components/{ui,shell,brand}`, `features/{dashboard,settings}`, `lib/`, `vercel.json` |
| CI | `.github/workflows/ci.yml` |

## Database changes
Tables: `users`, `user_settings`, `plans`, `subscriptions`, `usage_counters`, `audit_logs`.
Enums: `UserRole`, `PlanCode`, `SubscriptionStatus`. IDs are UUIDv7. Plans are seeded create-only,
so admin edits to limits survive deploys. Deleted accounts are soft-deleted and anonymised.

## API endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness + database check |
| GET | `/v1/me` | user | Profile, plan, limits, onboarding state |
| PATCH | `/v1/me` | user | Update name, timezone, reporting currency, P&L colours |
| POST | `/v1/webhooks/clerk` | Svix signature | Sync user create/update/delete |

Errors always return `{ statusCode, error, message, issues?, requestId }`.

## Security controls in this phase
Helmet headers, HSTS, per-IP rate limit (120/min), CORS allow-list, 100 kB body limit, strict input schemas
(unknown fields rejected), fail-fast env validation, JSON logs in production, request IDs, no internal error
details sent to clients, append-only audit log, no secrets in the repo.

## Future improvements
- Content-Security-Policy via Clerk's nonce support (needs a live browser test).
- Sentry error monitoring in both apps.
- Redis-backed rate limiting and user-lookup cache when the API runs more than one instance.
- Postgres Row-Level Security once tenant-owned trading tables exist (Phase 3).
