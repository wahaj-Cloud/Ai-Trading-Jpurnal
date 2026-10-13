# WickMentor

AI trading journal and coach (formerly "AI Trading Coach").

AI-reviewed trading journal and coach for crypto futures traders.

```
apps/web        Next.js web app (Vercel)
apps/api        NestJS API (Railway)
apps/worker     Background sync worker (Railway)
packages/db     Database schema, migrations, seed (Prisma + Postgres)
packages/crypto Envelope encryption for exchange credentials
packages/exchange-adapters  Exchange API clients: Binance, MEXC, KuCoin, BingX
packages/trade-engine       Rebuilds trades from fills; funding attribution
packages/analytics          Performance statistics, calendars, R multiples (pure, tested)
packages/shared Validation rules and data shapes shared by web and API
docs/           Architecture decisions and per-phase documentation
```

---

## Deploying (no programming needed)

Follow the steps in order. It takes about 45 minutes. Keep a private note (a password manager is
ideal) of every value marked **SAVE**. Never paste keys into chats, emails or screenshots.

### Step 1 — Put the code on GitHub
1. Install **GitHub Desktop** from desktop.github.com and sign in.
2. Unzip the project folder somewhere permanent (for example `Documents/ai-trading-coach`).
3. In GitHub Desktop: **File → Add local repository** → choose the folder. It will say this is not a
   repository yet → click **create a repository**. Keep the name `ai-trading-coach`, click **Create**.
4. Click **Publish repository**. Keep **Keep this code private** ticked. Click **Publish**.

### Step 2 — Database (Neon)
1. On neon.tech create a project named `ai-trading-coach`. Choose **AWS Europe (Frankfurt)** or
   **AWS Asia Pacific (Singapore)**. Use a matching region in Railway later.
   > **Do not choose a US region anywhere.** Binance (and other exchanges) block requests coming from US
   > servers, so exchange connections would fail.
2. Open **Connect**. Copy the connection string with **Connection pooling ON** → **SAVE as `DATABASE_URL`**.
3. Switch pooling **OFF** and copy again → **SAVE as `DIRECT_URL`**.

### Step 3 — Sign-in (Clerk)
1. On clerk.com create an application named `WickMentor`. Enable **Email** and **Google**.
2. Go to **API keys**. **SAVE** the Publishable key (`pk_test_…`) and Secret key (`sk_test_…`).

### Step 4 — API server and Redis (Railway)
1. On railway.com: **New Project → Deploy from GitHub repo** → pick `ai-trading-coach`.
   > Railway starts a first deploy straight away. **It will fail — that is expected**, because nothing
   > is configured yet. Carry on with the steps below; the deploy in step 5 is the one that counts.

   In the service **Settings → Deploy → Regions**, pick **EU West** (if Neon is in Frankfurt) or
   **Southeast Asia** (if Neon is in Singapore). Never a US region.
   Rename the service to `api` (click its name).
   Then, in the same project, click **Create → Database → Redis**. Railway adds a service named
   `Redis`: the job queue the API and the worker share.
2. Open the service → **Settings**. Find the config-file setting (**Config as code / Railway config file**)
   and set it to `/apps/api/railway.json`.
3. **Variables** tab → add:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | from Step 2 |
   | `DIRECT_URL` | from Step 2 |
   | `CLERK_SECRET_KEY` | from Step 3 |
   | `CLERK_WEBHOOK_SIGNING_SECRET` | `whsec_placeholder` (replaced in Step 7) |
   | `WEB_ORIGINS` | `https://example.com` (replaced in Step 6) |
   | `REDIS_URL` | type exactly `${{Redis.REDIS_URL}}` (Railway fills in the real address) |
   | `CREDENTIAL_KEYS` | `v1:` followed by a new random 64-character password (see below) |
   | `CREDENTIAL_ACTIVE_KEY_ID` | `v1` |
   | `EXCHANGE_EGRESS_IPS` | Railway's static outbound IP(s), comma-separated (see below). Leave empty if unavailable. |
   | `RAILPACK_DEPLOY_APT_PACKAGES` | `openssl` (the database migration tool needs it) |

   **Creating `CREDENTIAL_KEYS` (the master key that locks every user's exchange keys):**
   in your password manager (Bitwarden, 1Password, etc.) generate a password of **64 characters, letters
   and numbers only**. Save it in the password manager as "WickMentor master key", then paste
   `v1:` plus the password into Railway, e.g. `v1:Xy7…`.
   > **If this key is lost, every user must reconnect their exchange. If it leaks, rotate it immediately**
   > (docs/launch-hardening.md, "Rotating the master key"). Never reuse it anywhere else.
   > The example text from `.env.example` is refused: the service will not start with it.

   **`EXCHANGE_EGRESS_IPS`:** in the service **Settings → Networking**, enable **Static Outbound IPs**
   if your Railway plan offers it (it needs the paid Pro plan), and copy the address(es). Do the same on the worker (Step 4c) and
   list the addresses of **both** services here, comma-separated: users lock their keys to all of them.

4. **Settings → Networking → Generate Domain**. **SAVE as `API_URL`** (starts with `https://`).
5. Click **Deploy**. When it turns green, open `API_URL/health` in your browser.
   You should see `{"status":"ok"}`. The database tables and plans were created automatically.

### Step 4c — Sync worker (Railway)
The worker downloads trades from the exchanges every few minutes. It has no web address.
1. In the same Railway project: **Create → GitHub Repo** → `ai-trading-coach` again. Rename it `worker`.
   Pick the same region as the API. (Its first automatic deploy also fails until steps 2–3 are done.)
2. **Settings → Config as code / Railway config file** → `/apps/worker/railway.json`.
3. **Variables** tab → add:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | same as the API |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` |
   | `CREDENTIAL_KEYS` | **exactly the same** as the API |
   | `CREDENTIAL_ACTIVE_KEY_ID` | `v1` |

4. Click **Deploy**. In **Deployments → View logs** you should see `"msg":"worker started"`.

### Step 5 — Web app (Vercel)
1. On vercel.com: **Add New → Project** → import `ai-trading-coach`.
2. **Root Directory** → `apps/web`. Framework should show **Next.js**.
3. **Environment Variables** → add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | from Step 3 |
   | `CLERK_SECRET_KEY` | from Step 3 |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
   | `API_URL` | from Step 4 |
   | `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | optional, from Step 9 |
   | `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | `sandbox` (later `production`) |

4. Click **Deploy**. When it finishes, open **Project → Settings → Domains** and **SAVE** the
   **Production** domain shown there (for example `https://ai-trading-coach.vercel.app`; Vercel may add
   letters if the name is taken).
   > Use only this Production domain. The "Visit" button and preview links open per-deployment
   > addresses (with `-git-` or random letters); sign-in does not work on those.

### Step 6 — Allow the web app to talk to the API
In Railway → `api` service → Variables, set `WEB_ORIGINS` to the Production domain from Step 5, starting
with `https://`. Click **Deploy** to apply. If you later add your own domain (for example
`https://app.yourbrand.com`), add it here too, separated by a comma.

### Step 7 — Keep users in sync (Clerk webhook)
1. Clerk → **Webhooks → Add endpoint**. URL: `API_URL/v1/webhooks/clerk`.
2. Subscribe to `user.created`, `user.updated`, `user.deleted`. Create.
3. Copy the endpoint's **Signing secret** (`whsec_…`) into Railway `CLERK_WEBHOOK_SIGNING_SECRET`.
   Click **Deploy**.

### Step 8 — Test it
1. Open the Vercel address → **Create free account** (try Google too).
2. You should land on the dashboard with your name and the three setup steps.
3. **Settings** → change timezone → **Save changes** → "Changes saved." appears.
4. **Exchanges → Connect exchanges** → connect a read-only key. The connection shows
   "Importing your trade history". After a few minutes, **Trades** lists your last three months of trades.
5. **Dashboard** now shows your figures, equity curve, open positions and this month's calendar.
   **Analytics** shows the full statistics; switch between 7D, 30D and All.
6. Open any trade on **Trades**, give it a rating, tick an emotion, and **Save review**. The trade now
   shows a star on the Trades list, and **Analytics → From your journal** starts filling in.
7. On GitHub → your repository → **Actions**: both CI jobs should show a green tick.

### Step 9 — Optional services (turn features on)
Each of these is optional. Without it, the app still works and the feature explains that it is off.

| Feature | Service | Where to set it |
|---|---|---|
| **AI coach** (reviews, daily notes, chat) | console.anthropic.com → API keys | `ANTHROPIC_API_KEY` on the API **and** worker |
| **Email** reminders and reports | resend.com → verify your domain → API key | Worker: `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `WickMentor <coach@yourdomain.com>`), `APP_URL` (your Vercel address) |
| **Payments** | paddle.com (start in Sandbox) | See below |
| **Admin panel** | — | API: `ADMIN_EMAILS` = your sign-in email. Sign out and in again; **Admin** appears in the sidebar |
| **Error alerts** | sentry.io | `SENTRY_DSN` on API and worker |
| **Exness (MetaTrader)** | metaapi.cloud → sign up → **API access** → generate a token | Worker: `METAAPI_TOKEN` = the token. API: `EXNESS_ENABLED` = `true`. Each connected Exness account is billed by MetaApi while connected; see docs/exness-metatrader.md |

**Paddle (payments):**
1. Paddle → **Catalog → Products**. Create "Pro" and "Premium", each with a monthly and yearly price.
   Copy each price ID (`pri_…`).
2. Railway API variable `PADDLE_PRICES` =
   `PRO:month:pri_aaa,PRO:year:pri_bbb,PREMIUM:month:pri_ccc,PREMIUM:year:pri_ddd`.
3. Paddle → **Developer tools → Authentication**: create an API key → `PADDLE_API_KEY` (API) and a
   **client-side token** → `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (Vercel).
4. Paddle → **Developer tools → Notifications → New destination**: URL `API_URL/v1/webhooks/paddle`,
   select all `subscription.*` events. Copy the secret key → `PADDLE_WEBHOOK_SECRET` (API).
5. Paddle → **Checkout settings**: add your Vercel address as the default payment link / approved domain.
6. `PADDLE_ENVIRONMENT` (API) and `NEXT_PUBLIC_PADDLE_ENVIRONMENT` (Vercel) = `sandbox`. Test a checkout
   with card `4242 4242 4242 4242`: **Billing** should show your new plan within seconds.
   For real payments, repeat steps 1–5 in Paddle's live account and set both to `production`.
   Paddle approves live accounts only for a website on **your own domain** with the legal pages filled
   in (see docs/launch-hardening.md), so set up your domain first.

Before a public launch, follow **docs/launch-hardening.md** (KMS for the master key, strict
security policy, legal pages, checklist).

### If something goes wrong
| Symptom | Fix |
|---|---|
| Dashboard says "This page could not load" | Check `API_URL` in Vercel and that `API_URL/health` works |
| Sign-in works but you bounce back or see 401 | `WEB_ORIGINS` must match the Vercel address exactly (https, no trailing slash) |
| `/health` shows "Database unavailable" | Re-copy `DATABASE_URL` from Neon (pooling ON) |
| Railway deploy fails at "pre-deploy" | Re-copy `DIRECT_URL` from Neon (pooling OFF) |
| Railway logs say "Invalid environment configuration" | The log lists exactly which variable is wrong |
| Connecting an exchange says "temporarily unavailable from our servers" | Railway is in a US region. Change the region to Europe/Asia |
| An exchange says the key only works from other IP addresses | `EXCHANGE_EGRESS_IPS` must match the IPs added to the key on the exchange |
| Connecting says "could not confirm this key is read-only" | The exchange changed its API response. Check the API logs and tell your developer; no key was saved |
| An exchange stays on "Importing your trade history" for more than 15 minutes | Open the **worker** service logs in Railway. No logs: check its variables, especially `REDIS_URL` and `CREDENTIAL_KEYS` (must match the API) |
| Open positions look out of date | They refresh with each sync (every ~5 minutes); the "Updated … ago" line shows the last refresh. Older than 15 minutes: see the worker row above |
"AI coach is off" on Coach pages | Set `ANTHROPIC_API_KEY` on both API and worker, then redeploy both |
| No emails arrive | Worker needs `RESEND_API_KEY`; the `EMAIL_FROM` domain must be verified in Resend. Check Settings → notification emails are on |
| Paid in Paddle but plan still Free | Paddle → Notifications → your destination → check deliveries succeed; `PADDLE_WEBHOOK_SECRET` and `PADDLE_PRICES` must match Paddle exactly |
| No **Admin** link | `ADMIN_EMAILS` must be your exact sign-in email; sign out and in again |
| Worker logs say "sync failed, will retry" for one exchange | The exchange is down or limiting us. The worker retries by itself with growing delays (up to 6 hours); nothing to do unless it lasts a day |

---

## For developers

Requirements: Node 22.12+, pnpm 10, Postgres 16, Redis 7.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env          # fill in
cp apps/web/.env.example apps/web/.env.local    # fill in
cp apps/worker/.env.example apps/worker/.env    # fill in (same CREDENTIAL_KEYS as the API)
cp packages/db/.env.example packages/db/.env    # fill in
pnpm db:generate && pnpm --filter @atc/db build
pnpm --filter @atc/db migrate:deploy && pnpm db:seed
pnpm dev                                        # web :3000, api :4000, worker
```

Quality gates (also run in CI): `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
Integration tests (local Postgres and Redis only):
`DATABASE_URL=… pnpm --filter @atc/api test:integration` and
`DATABASE_URL=… REDIS_URL=… pnpm --filter @atc/worker test:integration`.

Schema changes: edit `schema.prisma`, run `pnpm db:migrate` to create a migration, commit both.
Without network access to Prisma's engine binaries, generate the migration with Prisma's bundled
WebAssembly engine and prove there is no drift:
`node packages/db/scripts/prisma-wasm.mjs between <old.prisma> <new.prisma> <empty-db-url>` and
`DRIFT_ADMIN_URL=postgresql://user:pass@localhost:5432 pnpm --filter @atc/db drift:check`.
