# Pre-launch audit report

**Date:** 3 October 2026
**Scope:** the whole monorepo (web, API, worker, all packages), with the closest attention on
phases 6–10 and launch hardening.
**Method:** two independent reviewers (security, and correctness/reliability). Each read the code
paths and verified every finding. All confirmed findings were fixed and covered by tests, then the
full pipeline was run again.

## Result

| Severity | Found | Fixed | Accepted (documented) |
|---|---|---|---|
| High | 4 | 4 | 0 |
| Medium | 12 | 12 | 0 |
| Low | 9 | 7 | 2 |

The audit confirmed these areas were sound and needed no changes:
- **Authentication:** every route is private by default. The only public routes are the signed
  webhooks and `/health`. Every `:id` route is scoped to the signed-in user.
- **Paddle signatures:** checked on the raw request body, in constant time, with a 5-minute replay
  window.
- **Exchange-key encryption:** AES-256-GCM with a per-record key, bound to its account and field.
  No key material reaches logs, audit records or Sentry.
- **SQL:** no unsafe raw SQL anywhere.
- **Outputs:** emails are escaped; CSV and Excel exports guard against formula injection.
- **Web app:** server actions validate their input, and the download route forwards only
  validated values.
- **No look-ahead in strategy analysis:** entries are judged only on candles that closed before
  the entry.

## Findings and fixes

### High
1. **Rate limits were per IP, but all browser traffic comes from the web server's IP.** One user
   could block everyone, and direct API callers rotating IPs had no limit at all.
   → Limits are now **per signed-in user**, checked after authentication
   (`common/user-throttler.guard.ts`). Integration test added.
2. **Deleted users' exchange keys stayed in use, and their accounts kept syncing and running AI.**
   → Account deletion now destroys every stored key, disconnects the accounts and clears live
   positions, all in one transaction. Admin suspension is a separate, reversible `suspended_at`
   flag. The sync scheduler, AI scheduling and notifications skip both. The migration cleans up
   existing data. Tests added.
3. **Switching plans opened a second Paddle checkout.** This billed the user twice, and cancelling
   the old subscription downgraded them. → Plan changes now go through Paddle's
   subscription-update API (`POST /v1/billing/change-plan`, prorated). Webhooks only act on the
   subscription linked to the user. Tests added.
4. **Older and CSV-imported trades showed "writing review…" forever with no button.** → A new
   `NONE` status: the trade page offers "Get AI review".

### Medium
- **Billing linking trusted the Paddle customer ID.** An attacker could link a victim's later
  payment to their own account. → Events now match on subscription ID. A new link requires the
  checkout's user ID **and** a matching customer email. Late events cannot revive a cancelled
  subscription. Duplicate deliveries are atomic (insert-first, row lock). Tests added.
- **Admins could freeze a paying user's plan** by re-granting the same plan, after which
  cancellations were ignored. → Manual plans are now refused while an online subscription exists.
- **Admin access did not require a verified email.** → Admin requires a verified primary email
  (`users.email_verified`). For existing accounts it is refreshed once from Clerk.
- **"Coach me on this day" had no AI cost cap.** → Limited to 10 a day per user.
- **The plan's history window was missing in four places:** the trade detail page, report
  best/worst trades and notes, behaviour insights, and strategy insights. → It is now applied
  everywhere.
- **Coin-settled (e.g. BTC) results were added into USD totals** in "habits that cost the most"
  and the best/worst rankings. → Now USD-only, the same as analytics.
- **A review could stay stuck as "writing" forever** after the queue's last retry. → The final
  attempt now records `FAILED`.
- **Notification scheduling could delay sync scheduling.** → The two now run on separate queues,
  and each step is isolated.
- **There were no BullMQ `error` listeners.** → Added to every queue and worker.
- **The risk check loaded the user's whole history after every sync.** → It now loads today's
  trades plus one SQL query for the equity peak.
- **Checkout could be switched on without webhooks.** → Startup now fails unless
  `PADDLE_WEBHOOK_SECRET` and `PADDLE_API_KEY` are set whenever `PADDLE_PRICES` is. Duplicate
  prices are rejected.
- **The CSP used an invalid wildcard for Clerk.** → The exact Clerk host is now read from the
  publishable key.

### Low
- **Parallel exchange connects could exceed the plan limit.** → The limit is re-checked under a
  per-user database lock. Test added.
- **Changing timezone stretched AI quotas.** → Usage is now counted on UTC days and months.
- **Impossible dates (`2026-02-31`) caused server errors.** → Strict calendar validation.
- **A late Clerk `user.updated` restored personal data on a deleted account.** → Ignored for
  deleted accounts.
- **A trade's grade used trades closed up to 24 hours after it.** → Grades now use only trades
  closed up to that trade.
- **Weekly notes that could not be written were retried daily.** → Now only Monday and Tuesday.
- **Other fixes:**
  - The CSV guard now also catches padded and full-width formula characters.
  - Coin amounts in AI facts keep 8 decimals.
  - A missing stop was penalised twice in grading.
  - Chat messages saved together have a stable order.
  - Indexes were added on `positions.closed_at` and `subscriptions.paddle_customer_id`.
  - Excel export no longer builds a throw-away report.

### Accepted (documented, not changed)
- **Maximum favourable and adverse excursion on long timeframes** is measured on whole entry and
  exit candles. On 4-hour charts this can overstate the excursion slightly. This is minor and
  does not affect the grade.
- **The API is publicly reachable.** Per-user limits now protect it. For extra defence, put it on
  a private network with the web app (Railway private networking) once traffic grows.

## Verification after fixes
- Lint (Biome): clean.
- Typecheck: all packages.
- Unit tests: 251, all passing.
- Production builds: all passing.
- Integration tests: 9 suites against real Postgres and Redis, all passing. Covered: exchange
  connections, journal and analytics, AI coach, strategy analysis, goals and notifications,
  reports and exports, billing and admin, rate limits, sync worker.
- Migration drift check: no drift.
- **Visual check:** the real API ran against a seeded demo account, and 20 pages were opened at
  desktop (1440 px) and phone (390 px) width. The pages covered dashboard, coach, conversation,
  journal, reviewed and unreviewed trades, goals, notifications, reports, billing, admin
  (overview, users, logs, announcements), help, analytics, settings, privacy and landing. There
  were no page errors and no horizontal overflow.
- **UI issues found and fixed during the visual check:**
  - Best and worst trades in reports hid the result column.
  - Prices outside the swing range showed as "−136%".
  - A profitable day read "5.99 of a −150 limit".
- The new drawdown query returns exactly the analytics figure (145.39 on the demo account).

## What still needs live verification
Exchange APIs, Anthropic, Paddle, Resend, Clerk and AWS KMS are unreachable from the build sandbox.
They were tested with protocol-accurate fakes. Run the "Test it" checklist in the README and
`docs/launch-hardening.md` against the real services before opening sign-ups.
