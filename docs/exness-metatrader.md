# Exness (MetaTrader) connections

## Purpose
Traders who use Exness for gold, forex, stocks, indices and crypto CFDs get the same automatic
journal, analytics, grades, AI coaching, reports and goals as crypto exchange users.

## Why MetaApi
Exness's own API is only offered in a few countries, and MetaTrader has no public web API. MetaApi
(metaapi.cloud) runs a MetaTrader terminal in the cloud and logs in with the account's **investor
password**. That password can only read the account: it cannot trade, deposit or withdraw. Other
trading journals use the same method.

## How a connection works
1. **The trader enters four things:** platform (MT5 or MT4), account number, server (for example
   `Exness-MT5Real8`) and investor password. The API checks them, encrypts the password the same way
   as exchange keys, and saves the account as **CONNECTING**. It never calls MetaApi itself.
2. **The worker connects the account step by step**, about once a minute
   (`apps/worker/src/sync/metatrader.ts` and `packages/exchange-adapters/src/metatrader/provision.ts`):
   1. It creates the MetaApi account. A random transaction ID is stored first, so a retry is never
      treated as a new account.
   2. It starts the terminal and waits for it to log in to the broker.
   3. It reads the account information, which **must** report `investorMode: true`. If MetaApi does
      not confirm investor mode, the connection is refused, the MetaApi account is removed, and the
      password is deleted.
   4. Once confirmed, the stored password is **replaced by the MetaApi account ID**. The account
      becomes ACTIVE and the first sync runs straight away.
3. **Wrong details are reported in plain words on the Exchanges page:**
   - A wrong password is reported as "did not accept this login".
   - An unknown server comes with "Did you mean …" suggestions from MetaApi.
   - A login that hasn't connected after 10 minutes is reported the same way as a wrong password.
4. **Sync:**
   - Deals (MetaTrader executions) are downloaded for the last 12 months, in 30-day windows, and
     stored one row per deal. Positions are rebuilt from every stored deal with the same position
     ID, so a trade that opened in one sync and closed in a later one is always complete.
   - Lots are converted to units with each symbol's contract size (gold: 100 oz per lot).
   - Commission becomes fees, swap becomes funding, and profit becomes gross P&L.
   - Cent accounts (USC) are converted to USD. Accounts in other currencies are reported in that
     currency, outside the USD totals.
5. **Daily check:** the connection must still be in investor mode. If it is not, it is removed at
   once.
6. **Billing control** (`cleanupMetatrader`, every 15 minutes):
   - MetaApi terminals of disconnected, failed or deleted connections are removed.
   - Terminals replaced by a reconnect are removed.
   - Terminals of suspended users are stopped. They restart automatically on the next sync after the
     suspension ends.

## Symbols
Exness adds a suffix for the account type ("XAUUSDm" Standard, "EURUSDc" Cent). The suffix is
dropped, so `XAUUSD` is one market across accounts. Forex and metal pairs split into base and quote
(XAU / USD). Stocks and indices (`AAPL`, `USTEC`) are quoted in USD. CFDs are never inverse.

## Limitations
- **Strategy analysis** (EMA, VWAP, structure, order blocks) needs price candles. MetaApi's candle
  data for MetaTrader 5 cloud accounts is not confirmed, so this panel says it is unavailable for
  Exness trades. Grades, behaviour detection, AI reviews, notes, chat, reports and goals all work.
- **Netting accounts:** in-and-out "reverse" deals (`DEAL_ENTRY_INOUT`) are treated as closing
  deals. Exness MT5 accounts are hedging accounts by default.
- **MetaTrader 4:** MetaApi presents MT4 history in the same deal format. This is untested against
  a real MT4 account.

## Configuration
| Service | Variable | Value |
|---|---|---|
| Worker | `METAAPI_TOKEN` | API access token from app.metaapi.cloud |
| API | `EXNESS_ENABLED` | `true` once the worker has the token |

## Cost
MetaApi bills each cloud account while it is deployed, with a minimum of 6 hours each time one
starts, on top of a monthly plan (Regular $30/month at the time of writing; check metaapi.cloud for
current prices). Exness connections count towards each plan's connection limit. To limit cost, you
could offer Exness on paid plans only (a small change in `exchange-accounts.service.ts`).

## Files
- `packages/exchange-adapters/src/metatrader/`: `metaapi.ts` (REST client), `provision.ts`,
  `history.ts` (deals → positions, open positions), `adapter.ts` (daily check), tests.
- `apps/worker/src/sync/metatrader.ts`: connecting and cleanup.
- `apps/api/src/exchange-accounts/exchange-accounts.service.ts`: `connectMetatrader`,
  `reconnectMetatrader`.
- `apps/web/features/exchanges/`: the MetaTrader form, guide and "Connecting" status.

## Database changes
Migration `20261012000000_exness_metatrader`:
- adds `EXNESS` to the `Exchange` enum;
- adds `CONNECTING` to the account status enum;
- adds an `exchange_accounts.metadata` column (server, platform, MetaApi account ID and connection
  state; never secrets).

## API
No new endpoints:
- `POST /v1/exchange-accounts` accepts `{exchange: "EXNESS", label, login, password, server, platform}`.
- `PUT /v1/exchange-accounts/:id/credentials` accepts `{login, password, server, platform}` for
  Exness accounts.

## Future improvements
Price candles for strategy analysis (from MetaApi once confirmed for MT5, or another market-data
provider), more MetaTrader brokers (IC Markets, Pepperstone, XM), and offering Exness on paid plans
only.
