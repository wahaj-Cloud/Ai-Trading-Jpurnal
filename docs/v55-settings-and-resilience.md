# v55: database resilience, new settings, data export

## Purpose

- **Database resilience.** In November 2026 the worker went into a crash loop. Neon had refused every connection after the free plan's monthly data transfer ran out, and Railway stopped restarting the worker after its retry limit. Now the worker waits out database outages and recovers by itself. Admins see the reason, and users get a calm "briefly offline" page instead of an error.
- **Useful settings.**
  - Quiet hours and an email pause.
  - Start page, default Order Flow timeframe and reduce motion.
  - Trading defaults (account size and risk per trade) that pre-fill the tools.
- **Your data.** A one-click download of everything the trader keeps in WickMentor (exchange keys are never included).

## Architecture

### Database resilience

- **Waiting at start-up.** Before the worker opens any queue, `packages/db` `waitForDatabase()` probes with `SELECT 1`. It retries after 5 s, 10 s, 20 s and so on, up to 5 minutes between tries, so waiting costs almost no database transfer.
- **Plain-language reasons.** `classifyDbError()` names the problem: quota, unreachable, auth, schema or other. The text never includes connection strings.
- **Waiting for migrations.** The worker then waits up to 15 minutes for this build's migrations to be applied, comparing `_prisma_migrations` with the bundled folder. The API applies them in `preDeployCommand`, and this removes the deploy-order race between the two services.
- **Status in Redis.** The worker writes its last database check to the Redis key `health:db` (expires after 15 minutes), once a minute while running. This works even while the database refuses connections.
- **Public status.** `GET /health/status` is public and throttled. It reports whether the database answers and since when, never the reason. The web app's error page uses it to show "WickMentor is briefly offline".
- **Admin view.** The admin overview shows a green "Database healthy" line or a red banner with the reason (for example, "upgrade the database plan").
- **Fewer duplicate downloads.** `SnapshotCache` now shares one download of a new snapshot version between readers asking at the same moment.

### Notifications

- **Stored settings.** `notificationPrefs` gains:
  - `quietHours {start, end, allowRisk}`, in the trader's time zone and allowed to wrap midnight;
  - `pausedUntil`, at most 24 hours ahead.
- **Holding emails.** `emailHeld()` decides whether an email waits:
  - Account emails (billing, security) always go through.
  - Risk warnings go through quiet hours unless the trader turned that off.
  - A pause holds everything else.
- **Sending them later.** A held email is stored as `PENDING` with 0 attempts. `deliverPendingEmails()`, which runs on the 15-minute engagement tick, sends it once the hold ends. Emails older than 24 hours are dropped. In-app notifications always appear straight away.

### App preferences

- **Storage.** A new `user_settings.app_prefs` JSON column, validated by `appPrefsSchema`.
- **Reading.** `readAppPrefs()` keeps the valid fields of a damaged save instead of failing.
- **Saving.** `PATCH /v1/me` merges `{ appPrefs }` with what is stored.
- **Start page.** Sign-in and `/` go to `/start`, which redirects to the chosen page.
- **Order Flow.** The page opens on the chosen timeframe when the link names none. Links now always state the timeframe.
- **Reduce motion.** The layout sets `data-motion="reduce"` and the CSS turns animations off.
- **Trading defaults.** `TradingDefaultsProvider` pre-fills the position size and risk-of-ruin calculators, the trade grader and new paper bots.

### Data export

- **API.** `GET /v1/me/export` (3 per hour) returns:
  - profile and settings;
  - connected accounts (label and status only);
  - trades and open positions;
  - journal, AI trade reviews, coach notes and coach chats;
  - goals and risk limits;
  - setups and their alerts, scalp alerts and zone alerts;
  - paper bots with their trades;
  - the last 1,000 notifications.
- **Download.** The web route `/settings/export` sends it as a JSON file.

## Database changes

- Migration `20261112000000_app_prefs` adds `user_settings.app_prefs JSONB NOT NULL DEFAULT '{}'`.

## API endpoints

- `GET /health/status`: public.
- `GET /v1/me/export`.
- `PATCH /v1/me`: now accepts `appPrefs`.
- `PUT /v1/notification-preferences`: now accepts `quietHours` and `pausedUntil`.
- `GET /v1/admin/overview`: now includes `database`.

## Future improvements

- In-app alert pop-ups with an optional sound.
- A daily email digest instead of separate alert emails.
- A clock format setting (12 or 24 hours) and a week-start setting for calendars and reports.
- An external uptime monitor watching `/health/status`.
