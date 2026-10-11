# Phase 8 — Goals, risk limits and notifications

## Purpose
Guard-rails that protect the account (maximum daily loss, maximum trades per day, maximum drawdown,
daily profit target), weekly and monthly goals, and reminders and reports in the app and by email.

## Architecture
- `packages/analytics/src/goals.ts` — pure evaluation. A limit becomes NEAR at 80% and BREACHED at
  100%.
- `packages/notify` — `notify()` with a dedupe key, email renderer (escaped HTML, links only into the
  app), and senders: Resend, disabled, and in-memory for tests. Scheduled jobs send daily and journal
  reminders, weekly and monthly reports, and goal reminders.
- Worker: runs a risk check after every sync, sends account-problem alerts, and sends notifications
  for new coach notes.
- Web: `/goals`, `/notifications`, a bell with an unread count, email preferences in Settings, and a
  risk banner on the dashboard.

## Database changes
Migration `20261004000000_goals_notifications`: `risk_limits`, `goals`, `notifications`.

## API endpoints
- `GET|PUT /v1/risk-limits`
- `GET /v1/risk-status`
- `GET|POST /v1/goals`, `DELETE /v1/goals/:id`
- `GET /v1/notifications`, `GET /v1/notifications/unread-count`, `POST /v1/notifications/read`
- `GET|PUT /v1/notification-preferences`

## Configuration
`RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` (worker). Without a key, notifications are in-app only.

## Future improvements
Push notifications (web push / mobile), Telegram alerts, and blocking trading via exchange
sub-account rules (not possible with read-only keys).
