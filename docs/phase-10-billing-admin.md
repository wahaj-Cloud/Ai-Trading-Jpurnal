# Phase 10 — Subscriptions and admin panel

## Purpose
Paid plans (Free, Pro, Premium, Enterprise) through Paddle, and an admin panel for users,
subscriptions, exchange status, logs, announcements and analytics.

## Architecture
- Billing (`apps/api/src/billing`)
  - Checkout runs in the browser with Paddle.js; the user ID is passed as custom data.
  - Webhook: HMAC signature check (5-minute replay window, supports secret rotation). Every event is
    stored once. Out-of-order events are ignored. Unknown prices and unknown users are ignored.
  - A user's live subscription is never replaced by another one.
  - Plans granted by support win over webhooks.
  - Cancellation returns the user to Free.
  - The Paddle customer portal handles card changes and invoices.
- Plan enforcement: the effective-plan rule (lapsed means Free limits) and the history window apply
  to exchange-account count, AI quotas, trades, analytics and exports.
- Admin (`apps/api/src/admin`)
  - `AdminGuard`: the role comes from `ADMIN_EMAILS` at every sign-in.
  - Admin pages: overview (users, plans, exchange health, sync failures, AI usage, sign-ups), user
    search and detail, manual plan grants and suspension (reason required, audited), audit and sync
    logs, announcements.
- Web: `/billing` and `/admin/*`; announcements show as a banner for everyone.

## Database changes
Migration `20261005000000_billing_admin`:
- New columns on `subscriptions`: `paddlePriceId`, `paddleEventAt`, `manualPlan`.
- New tables: `billing_events`, `announcements`.

## API endpoints
- `GET /v1/billing`, `POST /v1/billing/portal`
- `POST /v1/webhooks/paddle` (public, signed)
- `GET /v1/announcements`
- `/v1/admin/overview`
- `/v1/admin/users`, `users/:id`, `users/:id/plan`, `users/:id/suspension`
- `/v1/admin/logs/audit`, `logs/sync`
- `/v1/admin/announcements`

## Configuration
- API: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT`, `PADDLE_PRICES`,
  `ADMIN_EMAILS`.
- Web: `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENVIRONMENT`.

## Future improvements
Coupons and trials in Paddle; team (Enterprise) seats; revenue charts from Paddle's reporting API.
