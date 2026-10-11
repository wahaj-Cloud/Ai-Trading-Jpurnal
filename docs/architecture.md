# Architecture decisions (running record)

| # | Decision | Why |
|---|---|---|
| 1 | TypeScript monorepo (Turborepo + pnpm) | One language, shared types, one CI pipeline |
| 2 | Next.js web + separate NestJS API + (Phase 4) BullMQ workers | API reusable by a future mobile app; workers run sync 24/7 |
| 3 | PostgreSQL + Prisma 7, money as `NUMERIC`, timestamps UTC, day boundaries in the user's timezone | Financial correctness |
| 4 | Raw exchange data is immutable; trades/stats/AI output are derived and rebuildable | Logic can improve without re-downloading history |
| 5 | Deterministic code computes all numbers and behaviour flags; AI only explains and coaches | Accuracy, cost, trust |
| 6 | Exchange adapter interface with **native** clients (changed in Phase 3; CCXT reserved for long-tail exchanges) | Full fidelity of fills/funding data, explicit rate-limit control; new exchange = one adapter |
| 7 | Clerk for identity; local users table keyed by provider ID | Hardened auth now, replaceable later |
| 8 | Paddle (Merchant of Record) for billing | Works for a Pakistan-based company; handles global tax |
| 9 | API keys: envelope encryption (AES-256-GCM, per-record data key, AAD-bound). Beta: master key in platform secrets; AWS KMS before public launch. API only encrypts; workers decrypt. Keys with any non-read permission are rejected | Protects users' exchange accounts; KMS switch needs no data migration beyond re-wrapping data keys |
| 10 | Every API route private by default; shared validation schemas; append-only audit log | Secure by default |
| 11 | All code ESM; pinned stable versions (no release candidates) | Current ecosystem direction; reproducible builds |
| 12 | API servers run outside the US (EU/Singapore) | Binance and others block requests from US IPs |
| 13 | Reconnects must match the stored exchange account ID | A key swap can never mix two traders' histories |
| 14 | One exchange catalog in `@atc/shared` drives web and API; the adapter registry must cover every catalog entry (type-checked) | Adding an exchange cannot half-ship |
| 15 | Read-only policy is shared and fail-closed: only known read permissions pass; unknown permissions are unsafe; if a permission we must see is unreported, the key is not saved | Same safety bar on every exchange, including future API changes |
| 16 | Multi-exchange connect is a URL-carried queue, not server state | Survives reloads, needs no storage, every value re-validated |
| 17 | Exchange marks are neutral monograms, never exchange logos | Avoids reproducing third-party trademarks |
| 18 | Per-exchange data model: FILLS (Binance, engine rebuilds trades) vs POSITIONS (MEXC, KuCoin, BingX report trades) | Use each exchange's most complete data; BingX fills can omit the side |
| 19 | Raw exchange data immutable; journal positions always rebuilt per symbol from raw data | Idempotent syncs; logic improvements never need re-downloads |
| 20 | Worker is the only service that decrypts keys; one BullMQ job per account (job ID = account) | Least privilege; no double syncs |
| 21 | Shared Redis rate limiter per exchange around every HTTP call | Limits are per server IP across all users |
| 22 | Per-account failure backoff (5 min doubling to 6 h) on top of job retries | No request storms during outages or regional blocks |
| 23 | Keys re-verified daily; a key that gained trading rights is deleted immediately | The read-only promise holds after connection, not only at it |
| 24 | Our own CSV template for history beyond the exchanges' ~3-month API window; all-or-nothing uploads | Predictable imports; exchange-specific formats need real samples |
| 25 | Migrations authored with Prisma's WebAssembly engine + an offline drift check when the native engine is unreachable | Exact Prisma SQL without network access; CI keeps the official check |
| 26 | Analytics computed on request by a pure package (`@atc/analytics`) from the trades table, not stored as rollups | One source of truth; identical figures on dashboard, exports and AI coach. Add a cache or rollups only when measured load requires it |
| 27 | Days, months, hours and weekdays follow the trader's timezone (Intl, DST-safe); sessions use UTC | A Lahore trader's "today" is not the server's |
| 28 | Only USD-stablecoin-settled trades enter money totals; coin-margined (inverse) trades are listed but reported separately | Never add BTC to USDT; positions now store their settlement currency |
| 29 | Live open positions are a separate snapshot table replaced on every sync | Mark price and unrealised PnL change constantly and must never touch the journal |
| 30 | Journal entries are keyed by the trade's stable source key, not a foreign key | Notes survive the sync engine rebuilding a trade; removing an exchange account removes its notes |
| 31 | Emotions and mistakes are fixed code lists; setups and tags are free text | Countable behaviour for statistics and the AI coach, flexibility where traders need it |
| 32 | Time-series charts use TradingView's open-source Lightweight Charts; categorical charts and the calendar are server-rendered HTML | Familiar look for traders, small client bundle, no chart library for simple bars |
| 33 | AI works on facts computed by code (behaviour flags, grades, market context); the model only explains. Output is forced through a JSON tool schema and validated with zod; every result stores the prompt version and an input hash | Numbers never hallucinated; results reproducible and cheap to re-run only when inputs change |
| 34 | Two model tiers: a fast model for per-trade reviews, a smarter model for daily/weekly notes and chat. Anthropic called over plain HTTPS with prompt caching; the app runs fully (rules-based) without a key | Cost control; no vendor lock-in in the code; AI outage never breaks the journal |
| 35 | AI usage is reserved atomically in SQL before the call (count < plan cap) and released on failure | Plan limits hold under concurrency; failed calls never cost the user quota |
| 36 | Journal notes reach the model fenced in `<journal>` tags and treated as data | Prompt-injection resistance for user-written text |
| 37 | Market analysis (indicators, BOS/CHOCH, FVGs, order/breaker/mitigation blocks, liquidity, premium/discount) is a pure package (`@atc/ta`) on public exchange candles, using only candles closed before entry | No look-ahead bias; testable; no paid data vendor |
| 38 | Risk limits are checked by the worker after every sync; notifications carry a dedupe key; email is optional (Resend) and links only into the app | One warning per breach, never spam; email safe from injection |
| 39 | Reports and exports are generated on request from the same analytics package; CSV cells are guarded against spreadsheet formula injection | Identical numbers everywhere; exports safe to open in Excel |
| 40 | Billing state comes only from signed Paddle webhooks (HMAC, 5-minute replay window), recorded idempotently, applied in event order, never overwriting another user's live subscription or a support-granted plan | Money state cannot be forged, replayed or reordered |
| 41 | "Effective plan": a lapsed/paused/past-due paid plan gets Free limits; the plan's history window hides older closed trades everywhere (lists, analytics, exports, AI) | One rule enforced in one helper |
| 42 | Admin role derives from `ADMIN_EMAILS` at every sign-in (promote and demote); every admin action is audited with a reason; admins cannot suspend themselves | No hidden admin backdoors; accountable support actions |
| 43 | Production master keys are stored KMS-encrypted (`CREDENTIAL_KEYS_KMS`) and decrypted once at boot; plain `CREDENTIAL_KEYS` remains for development | Env-variable leak alone no longer exposes exchange keys; no data migration needed |
| 44 | API rate limits are per signed-in user (checked after authentication), stored in Redis (atomic Lua), failing open if Redis is down | Browser traffic arrives via the web server's IP, so per-IP limits would lump all users together; Redis keeps limits across instances |
| 45 | Error monitoring (Sentry) is optional and sends no request bodies, cookies or user data | Observability without leaking secrets |
| 46 | Deletion and suspension are separate: deletion (identity provider) scrubs personal data and destroys exchange keys in one transaction; suspension (admin) is a reversible flag that stops sign-in, sync, AI and notifications | Deleted users' keys never stay in use; support actions are reversible |
| 47 | Plan changes for paying users go through Paddle's subscription-update API (prorated), never a second checkout; webhooks only act on the subscription linked to the user | No double billing; a canceled old subscription cannot downgrade a live one |
| 48 | AI allowances count on UTC days and months; on-demand coaching notes have their own daily cap | Changing timezone cannot stretch quotas; no unbounded AI spend |
| 49 | A trade's grade only uses trades closed up to that trade | Grades never change after the fact |
| 50 | Binance fees paid in BNB are converted to the quote currency at that minute's BNB price (futures market, then spot); the original amount stays in the raw record | Net PnL and fee statistics stay right for the many traders who use the BNB discount |
| 51 | Fills-based positions are rebuilt incrementally from the last moment the symbol was flat before the new activity (full rebuild gives identical results) | Sync cost grows with new activity, not with a trader's whole history |
| 52 | Binance symbols are discovered once per sync run from the whole run's income ledger; every symbol is checked in every window | Trades opened with zero-fee fills in one window and closed in the next are complete |
| 53 | In one-way mode, an oversized close of the first position at the start of history closes it as incomplete instead of flipping | No phantom positions that swallow later fills |
| 54 | Master-key rotation is automatic: the worker re-wraps stored credentials with the active key | Rotation needs only configuration changes, no scripts |
| 55 | Only the queue's last retry counts towards an account's sync backoff; key re-check failures use the same backoff | Short outages don't jump to 6-hour delays; failing re-checks don't cause request storms |
| 56 | Empty or space-padded environment values count as "not set"; trailing slashes are removed from origins | Pasting settings into hosting dashboards cannot stop a service from starting |
| 57 | MetaTrader brokers (Exness) connect through MetaApi with the investor password; the connection must report investor mode or it is refused and removed (fail closed) | No public Exness API in most regions; investor passwords are read-only by design, matching our read-only promise |
| 58 | MetaTrader connections are made by the worker in short repeated steps (status CONNECTING); the API only validates and encrypts | Logging in takes minutes; the worker stays the only service that decrypts secrets |
| 59 | The investor password is deleted once the connection is proven read-only; only the MetaApi account id is kept (encrypted) | Least data held: a database leak exposes no broker passwords |
| 60 | MetaTrader deals are stored one per row and positions rebuilt from all deals with the same position id | Trades spanning several syncs are always complete |
| 61 | Unused MetaApi terminals (disconnected, failed, deleted, replaced) are removed and suspended users' are stopped by a 15-minute cleanup | MetaApi bills per deployed account |
