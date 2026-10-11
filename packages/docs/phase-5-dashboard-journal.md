# Phase 5: Performance Dashboard, Analytics, Journal and Live Positions

## Purpose
Turn synced trades into answers: how am I doing, where do I make and lose money, and what was I
thinking on each trade. The journal also collects the data the AI coach (next phase) learns from.

## What the trader gets
| Screen | Contents |
|---|---|
| **Dashboard** | Net P&L, today, this month, win rate and profit factor; equity curve; live open positions with unrealised P&L and a liquidation warning; this month's P&L calendar; latest trades |
| **Analytics** (`/analytics`) | Periods 7D, 30D, 90D, YTD, 1Y and All, plus an exchange filter. About 20 statistics in five groups (results, edge, wins and losses, risk, habits). Charts: equity curve, daily P&L, drawdown, calendar, month bars. Breakdowns by hour, weekday and session; by coin; long vs short; setups, costliest mistakes and emotions from the journal |
| **Trade page** (`/trades/:id`) | Result (net, gross, fees, funding, entry, exit, size, R multiple, planned reward:risk), executions (Binance) and the review form |
| **Review form** | Rating 1–5, setup (suggestions from past setups), planned stop and target, emotions, mistakes, notes, tags, up to 4 chart links |
| **Trades → Open now** | Live positions from every exchange |

## Architecture
```
worker sync ──> positions (journal trades)      open_positions (live snapshot, replaced each sync)
                     │                                   │
journal_entries ─────┤ (joined by source key)            │
                     ▼                                   ▼
API  GET /v1/analytics ── @atc/analytics (pure) ──> AnalyticsDto
     GET /v1/positions/:id, PUT|DELETE /v1/positions/:id/journal
     GET /v1/open-positions
web  Dashboard · Analytics · Trade page · Trades/Open now
```

### Metric definitions
All figures use closed trades only.

- **Net P&L** is net of fees and funding.
- **Win rate** = wins ÷ (wins + losses). Break-even trades are excluded.
- **Profit factor** = total won ÷ total lost. It is empty when there are no losses (never infinity).
- **Expectancy** = net P&L ÷ trades.
- **Reward:risk (realised)** = average win ÷ average loss.
- **Max drawdown** is the largest fall of cumulative P&L from its running peak, measured trade by trade. It is shown in currency; a percentage needs account balance history (future work).
- **Streaks** count consecutive wins or losses. Break-even trades neither extend nor break a streak.
- **R multiple** = net result ÷ (|entry − planned stop| × size). It is empty when the stop is on the profitable side of the entry.
- **Sessions** are assigned by opening time in UTC:

  | Session | UTC hours |
  |---|---|
  | Asia | 00–07 |
  | London | 07–13 |
  | New York | 13–21 |
  | Off-hours | 21–24 |

- **Days, months, hours and weekdays** follow the trader's timezone setting, including daylight-saving changes.
- **Currency:** only USDT, USDC, FDUSD, BUSD and USD settlement counts in totals. Coin-margined trades are counted separately and flagged.

### Live open positions
Each sync ends by replacing the account's snapshot. If live positions cannot be fetched (for example a
market-data endpoint is down), the history sync still succeeds and the previous snapshot stays, with its age shown, . Figures are "as of the last sync" (normally at most about 5 minutes old). When a key becomes invalid or is deleted, the snapshot is removed so stale figures are never shown.

| Exchange | Endpoint | Notes |
|---|---|---|
| Binance | `/fapi/v3/positionRisk` | Leverage is computed as notional ÷ initial margin |
| MEXC | `/api/v1/private/position/open_positions` | Unrealised P&L is computed from the public fair price, because MEXC does not report it |
| KuCoin | Classic: `/api/v1/positions`. Unified: `/api/ua/v1/unified/position/open-list` | |
| BingX | `/openApi/swap/v2/user/positions` | The mark price is derived when it is missing |

### Inverse contracts (fix)
KuCoin `XBTUSDM` and MEXC `*_USD` contracts pay profit in coins. Two changes:
- Positions now store `settle_asset`. Existing rows are backfilled in the migration.
- The Trades page labels P&L with the settlement currency, and size in USD for these contracts.
- Dated delivery contracts (e.g. Binance `BTCUSDT_260327`) now parse as BTC/USDT, settle in USDT, and keep
  the expiry in the symbol so they never merge with the perpetual.

## Files created or modified
| Area | Path |
|---|---|
| Analytics engine | `packages/analytics/*` (new): `compute.ts`, `range.ts`, `time.ts`, `risk.ts`, tests |
| Shared | `analytics.ts`, `journal.ts` (new); `positions.ts` (settle and size currency, review flags, open-position DTOs) |
| Adapters | `history/snapshot.ts` (new); `fetchOpenPositions` in each of the 4 `history.ts` files; `symbols.ts` (settle currency) |
| Database | Migration `20261001000000_journal_open_positions` |
| Worker | `sync/open-positions.ts` (new); `sync-account.ts` (snapshot and cleanup) |
| API | `analytics/*`, `open-positions/*`, `positions/journal.service.ts` (new); `positions.service.ts` (detail, review flags); `positions.controller.ts`; `users.service.ts` (onboarding step 3) |
| Web | `app/(app)/analytics`, `app/(app)/trades/[id]`; `features/{analytics,charts,journal}/*`; dashboard, Trades page, navigation |

## Database changes
- New table `open_positions`: live snapshot, unique `(account_id, external_id)`, indexed by user, cascades with the account.
- New table `journal_entries`: unique `(user_id, position_key)`, GIN index on `tags`, cascades with the account and the user.
- New enum `MarginMode`.
- New column `positions.settle_asset`, backfilled.

## API endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/analytics?range=7d\|30d\|90d\|ytd\|1y\|all&from&to&exchange&accountId` | Full analytics report (60 requests per minute) |
| GET | `/v1/open-positions` | Live positions, total unrealised P&L and the "as of" time |
| GET | `/v1/positions/:id` | Trade detail: trade, journal, risk, fills, setup suggestions |
| PUT | `/v1/positions/:id/journal` | Save the review (replaces it; validated; 60 per minute) |
| DELETE | `/v1/positions/:id/journal` | Clear the review |
| GET | `/v1/positions` | Each trade now includes `reviewed`, `rating`, `settleAsset` and `sizeAsset` |

## Testing
- **196 unit tests.** New ones cover:
  - Analytics: every metric, the timezone and DST calendar, ranges, inverse exclusion, journal breakdowns and R.
  - Open positions on all 4 exchanges.
  - Journal validation (rejects `http:`/`javascript:` links, unknown codes, oversize input).
  - The web form parser.
- **API integration: 21 checks,** 6 of them new (they also cover a double-submitted first save and
  "this month" staying correct when a shorter period is shown):
  - Journal save, review flags and R multiple.
  - Tenant isolation.
  - The journal surviving a trade rebuild.
  - Analytics in the trader's timezone.
  - Live positions.
  - Cascade cleanup.
- **Worker integration:** live positions for Binance and MEXC, clearing on close, removal when a key is
  deleted, and a market-data outage that must not fail the sync.
- **Independent code review:** a separate reviewer checked the whole change. Every finding was fixed:
  - Failed saves wiping the review form.
  - Live-position errors failing the whole sync.
  - Delivery-contract symbols.
  - Unknown MEXC contract sizes.
  - "Today" and "this month" depending on the selected period.
  - Concurrent first saves.
  - A stray Redis file in the repository.
- **Visual check:** every new screen was rendered at 1440 px and 390 px from real API output (140 demo trades), with no horizontal overflow and no console errors.

## Needs live verification
- KuCoin unified-account open-positions path and fields (`/api/ua/v1/unified/position/open-list`).
- BingX: whether `markPrice` is present (it is derived when missing).
- MEXC: the fair-price ticker for every symbol a user holds.

## Future improvements
- CSV re-import with corrected prices creates a new trade key, so its old journal entry no longer attaches.
  Base CSV identity on exchange, symbol, direction and open time only (needs a data migration).
- Cache analytics per user in Redis, invalidated by sync, if report times grow with very large histories.
- Drawdown as a percentage once account balance snapshots are stored.
- Screenshot uploads (object storage) instead of links.
- Filter trades by "not yet reviewed" and by setup, tag or mistake.
- Real-time open positions via exchange WebSockets.
