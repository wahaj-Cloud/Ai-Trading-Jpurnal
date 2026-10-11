# Phase 4 — Automatic Trade Sync

## Purpose
Every connected exchange account is downloaded automatically: a ~3-month backfill on connect, then an
incremental sync every 5 minutes. Downloads become journal trades ("positions"). Older history can be
imported from a CSV template.

## Key decision: two data models
The Phase 1 plan was to rebuild every trade from fills. Research showed that is unreliable on some
exchanges; BingX's fill feed, for example, can omit the side. So each exchange uses its most complete source:

| Exchange | Model | Source of truth |
|---|---|---|
| Binance | **FILLS** | `/fapi/v1/userTrades` (side, position side, fee, exchange realised PnL) and `/fapi/v1/income` (funding, commissions). Our engine rebuilds positions. |
| MEXC | **POSITIONS** | `/api/v1/private/position/list/history_positions`. Contracts are converted with `/api/v1/contract/detail`. |
| KuCoin | **POSITIONS** | Classic: futures `/api/v1/history-positions` (partial closes merged by `positionId`). Unified account: `/api/ua/v1/position/history` (nanosecond times). The account type is detected via `/api/ua/v1/account/mode`. Lots are converted with `/api/v1/contracts/active`. |
| BingX | **POSITIONS** | `/openApi/swap/v1/trade/positionHistory` per symbol. Symbols are discovered from `/openApi/swap/v2/user/income`. |

Raw data is stored as received: `fills`, `income_events`, and `exchange_positions` (raw payload plus the
contract size needed to read it). Journal `positions` are always rebuilt from raw data, so improving the
logic never requires re-downloading.

## Architecture
```
Scheduler tick (every minute, once across all workers)
  -> queue "exchange-sync" (one job per account; job ID = account)
       -> worker: syncAccount
            1. decrypt credentials (worker only)
            2. daily re-verification: key gained trading rights -> delete key, mark INVALID
            3. for each window [cursor - 10 min, now] sized to the exchange's limit:
                 fetchHistory (every HTTP call passes the shared Redis rate limiter)
                 save raw data (idempotent) -> rebuild affected symbols -> save cursor
            4. success: lastSyncedAt, reset backoff | user-fixable error: INVALID + message
               | transient error: retry (queue: 1, 2, 4 min) then per-account backoff (5 min doubling, max 6 h)
API: connect / replace key -> enqueue BACKFILL; "Sync now" -> enqueue MANUAL
```

### Trade engine (`packages/trade-engine`)
Pure, exact-decimal code with no I/O. The rules:
- **Average-cost method.** Entry is the size-weighted average of all opening fills. Profit on each close is (exit − average entry) × closed size, reversed for shorts.
- **One-way mode flips.** A fill larger than the open size closes the position and opens the opposite direction; the fill is split between the two trades, fees included.
- **Hedge mode.** Long and short sides are tracked independently. A close larger than the known size marks the trade *incomplete*.
- **Trades opened before the history window.** The entry price is recovered from the exchange's realised PnL: entry = exit − PnL / size for longs.
- **Gross PnL.** When every closing fill reports the exchange's realised PnL, that figure is used, because the exchange is the ledger.
- **Funding.** Each funding payment is assigned to the trade(s) open on that symbol at that instant. If a long and a short are open at once, it is split by size.
- **Net PnL.** Net = gross − fees + funding.

### Rate limits (shared by all worker processes, per exchange)

| Exchange | Budget | Weighting / note |
|---|---|---|
| Binance | 1,200 weight/min | Half the published limit. Income costs 30, trades 5. |
| MEXC | 8 requests/s | |
| KuCoin | 10 requests/s | |
| BingX | 2 requests per 1.1 s | Its per-IP limit is shared by all users. |

## Files created / modified
| Area | Path |
|---|---|
| Engine | `packages/trade-engine/*` (new) |
| Adapters | `exchange-adapters/src/{symbols,http,types}.ts`, `history/*`, `{binance,mexc,kucoin,bingx}/history.ts`, `mexc/client.ts`, `kucoin/client.ts`, `registry.ts` |
| Database | 2 migrations (`trade_sync`, `sync_backoff`); `scripts/prisma-wasm.mjs`, `scripts/check-drift.sh` |
| Worker | `apps/worker/*` (new): `main.ts`, `scheduler.ts`, `rate-limit.ts`, `sync/{sync-account,persist,rebuild}.ts`, tests, `railway.json` |
| API | `sync/*`, `positions/*`, `exchange-accounts/*`, `users/users.service.ts`, `config/env.ts` |
| Shared | `jobs.ts`, `positions.ts`, `csv-import.ts`, `exchanges.ts` (sync status) |
| Web | `/trades`, `/trades/import`, `/trades/import/template`, `features/trades/*`, sync status + "Sync now" on Exchanges, dashboard step 2 |
| CI / docs | Redis service; worker integration and unit tests; README deploy steps 4 and 4c |

## Database changes
- New tables:
  - Raw data: `fills`, `income_events`, `exchange_positions`.
  - Derived: `positions`, `position_fills`.
  - Bookkeeping: `sync_cursors`, `sync_runs`.
- `exchange_accounts` gains:
  - `last_synced_at`, `history_starts_at`, `backfill_completed_at`: sync progress.
  - `sync_failures`, `sync_retry_at`: backoff.
  - Index on `(status, last_synced_at)`.
- Identity:
  - `fills` are unique per `(account_id, exchange_fill_id)`, and `income_events` per `(account_id, external_id)`, so re-downloading is a no-op.
  - `positions` are unique per `(user_id, source_key)`. Engine keys are namespaced by account; CSV keys are `csv:<sha256>`.

## API endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/exchange-accounts/:id/sync` | Queue a sync now (6/min). Returns 202. |
| GET | `/v1/exchange-accounts` | Now includes `sync: { state, lastSyncedAt, historyStartsAt, backfillCompletedAt }`. |
| GET | `/v1/positions?status&exchange&symbol&cursor&limit` | Trades, newest first, keyset-paginated. |
| POST | `/v1/imports/positions` | Up to 200 validated template rows per call. Re-imports update; rows inside synced history are skipped. |

## Testing
- **141 unit tests.** They cover the engine (flips, hedge, orphans, decimals), every exchange's history parsing (from documented and CCXT-recorded payloads), the CSV parser and the rate limiter (on real Redis).
- **API end-to-end: 15 checks.**
- **Worker end-to-end: 8 checks**, against real Postgres and Redis, with fake Binance and MEXC servers that verify signatures and enforce windows. They cover:
  1. Binance backfill: entry 60,500, exit 62,000, net 297.8.
  2. Re-sync adds nothing twice.
  3. An open trade closes in place.
  4. MEXC contract conversion and the retention cut-off.
  5. A revoked key stops syncing.
  6. A key that gained trading rights is deleted.
  7. Scheduler and queue dedupe with a real BullMQ worker.
  8. Outage backoff.
- **Migrations:** generated by Prisma's own engine and proven drift-free.
- **Worker process:** boots against real services, schedules every minute, and exits cleanly on SIGTERM in 18 ms.

## Must be verified live (my build environment cannot reach exchanges)
In priority order:
1. KuCoin: unified-account endpoint parameters and size units, the classic `closeSize` units, and whether futures probes work for unified accounts.
2. BingX: whether `positionHistory` filters by open or close time (we look back 30 days to be safe), and the response key (`positionHistory` vs `list`; both are handled).
3. MEXC: the `holdVol`/`closeVol` semantics on partially closed positions.
4. Binance: fee handling when paid in BNB. Those fees are kept on the fill but excluded from PnL until price conversion exists (Phase 5).

BingX's demo environment (`BINGX_BASE_URL=https://open-api-vst.bingx.com`) allows free live tests.

## Known limits
- History before ~3 months ago comes only from CSV. Exchange-specific export formats need sample files.
- Open positions on MEXC, KuCoin and BingX appear once (partially) closed; live open-position tracking is Phase 5.
- Fees paid in a non-quote asset (e.g. BNB on Binance) are not yet converted.

## Future improvements
- Exchange-specific CSV mappers (Binance and Bybit exports).
- Email when a key needs attention or a MEXC key nears expiry (Phase 9).
- Per-user fairness in the queue if one account's backfill is very large.
