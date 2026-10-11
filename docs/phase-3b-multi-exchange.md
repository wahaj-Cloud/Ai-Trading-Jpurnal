# Phase 3b — Binance, MEXC, KuCoin and BingX Connections

## Purpose
Traders can connect any of the four supported exchanges, or all of them in one guided flow, with the same
read-only guarantee Phase 3 established for Binance. Several accounts on the same exchange are allowed.

## Architecture
One exchange catalog (`@atc/shared/exchanges.ts`) drives the web forms, guides and validation.
Each exchange has an adapter that implements the same interface and shares three building blocks:

| Building block | File | Role |
|---|---|---|
| Transport + signing helpers | `exchange-adapters/src/http.ts` | Timeouts, HMAC hex/base64, param joining |
| Read-only policy | `exchange-adapters/src/permissions.ts` | Accept only known read permissions; everything else, including unknown future permissions, is unsafe; fail closed if a permission we must see is not reported |
| Messages | `exchange-adapters/src/messages.ts` | One user-facing message per failure, naming the exchange |

### How each exchange proves a key is read-only

| Exchange | Permission source | Accepted | Account ID | Futures probe | IP lock reported | Key expiry |
|---|---|---|---|---|---|---|
| Binance | `GET /sapi/v1/account/apiRestrictions` (booleans) | `enableReading` only | `/api/v3/account` `uid` | `/fapi/v1/income` | Yes | No |
| MEXC | `GET /api/v3/apiKeyInfo` (comma list) | `*_READ` only; needs `SPOT_ACCOUNT_READ`, `CONTRACT_ACCOUNT_READ`, `CONTRACT_DEAL_READ` | `/api/v3/uid` | `/api/v1/private/account/assets` | Yes | Yes (`remainingValidity`) |
| KuCoin | `GET /api/v1/user/api-key` (comma list) | `General` only | same response `uid` | futures `/api/v1/account-overview` | Not always | No |
| BingX | `GET /openApi/v1/account/apiPermissions` (booleans incl. `enableWithdrawals`) | `enableReading` only | `/openApi/account/v1/uid` | `/openApi/swap/v3/user/balance` | Yes | No |

Signing:
- **Binance:** HMAC-SHA256 hex of the query. Tested against Binance's published example.
- **MEXC:**
  - Spot: HMAC hex of the query.
  - Futures: HMAC hex of `apiKey + timestamp + sorted query`, sent in headers.
- **KuCoin:** base64 HMAC of `timestamp + METHOD + path?query`. The passphrase is sent HMAC-encrypted, with key version 2.
- **BingX:** HMAC hex of the ASCII-sorted query. Tested against BingX's published example.

### Connect several at once
The picker (`/exchanges/connect`) submits a plain GET form, so it works without JavaScript. `/exchanges/connect/start` then turns the picks into a URL queue:

```
/exchanges/connect/kucoin?q=BINANCE,KUCOIN,BINGX&done=BINANCE
```

How the queue behaves:
- Each step verifies and saves one key, then moves to the next exchange. Traders can also skip a step.
- The queue lives only in the URL and is re-validated on every read. The API still enforces plan limits.
- When the plan is full part-way through, the flow finishes and lists what was connected.

## Files created / modified
| Area | Path |
|---|---|
| Shared | `packages/shared/src/exchanges.ts` (catalog, passphrase rules, DTO fields) |
| Adapters | `packages/exchange-adapters/src/{types,http,permissions,messages,registry,test-utils}.ts`, `binance/*` (refactored), `mexc/*`, `kucoin/*`, `bingx/*` (+ tests) |
| Database | `schema.prisma`; migration `20260928000000_more_exchanges`; seed (Pro plan: 5 connections) |
| API | `exchange-accounts.service.ts`, `exchange.providers.ts`, `config/env.ts`, `test/fake-kucoin.mjs`, `test/exchange-accounts.itest.mjs` |
| Web | `features/exchanges/{queue,actions,key-guides,key-form,exchange-picker,exchange-mark,connection-list}.ts(x)`, `app/(app)/exchanges/**`, landing and dashboard copy |

## Database changes
- `Exchange` enum gains `KUCOIN` and `BINGX`.
- `exchange_accounts.ip_restricted` is now nullable (NULL = the exchange does not report it).
- New `exchange_accounts.key_expires_at`.
- `exchange_credentials.passphrase_cipher` (already present) now stores KuCoin passphrases, encrypted like secrets.

## API changes
The endpoints are unchanged. Their behaviour now:
- Connecting accepts `exchange` ∈ BINANCE | MEXC | KUCOIN | BINGX, plus `passphrase`, which KuCoin requires and the others reject.
- Replacing a key enforces the same passphrase rule, based on the stored account's exchange.
- Responses include `keyExpiresAt`, and `ipRestricted` may be `null`.
- `UNVERIFIABLE_PERMISSIONS` returns 503 and logs an error: we never save a key we could not prove safe.

## Testing
- **93 unit tests** in total, 63 of them for the exchange adapters. The adapter suites cover signing, every rejection path, the fail-closed cases and error-code mapping.
- **13 end-to-end checks** run against real Postgres, with signature-checking fake Binance and fake KuCoin servers, in CI.

## Live verification checklist (before beta)
My build environment cannot reach exchange servers. Before inviting users, test with a real key on each exchange, running from the deployed servers:

| Check | Binance | MEXC | KuCoin | BingX |
|---|---|---|---|---|
| Read-only key connects | ☐ | ☐ | ☐ | ☐ |
| Key with futures trading is rejected, naming the permission | ☐ | ☐ | ☐ | ☐ |
| Key with withdrawals is rejected | ☐ | ☐ | ☐ | ☐ |
| Wrong secret gives "Secret Key does not match" | ☐ | ☐ | ☐ | ☐ |
| IP-locked key without our IP gives the IP message | ☐ | ☐ | ☐ | ☐ |
| Account ID is captured (reconnect with another account is refused) | ☐ | ☐ | ☐ | ☐ |
| Key expiry date shown | n/a | ☐ | n/a | n/a |
| Wrong passphrase gives the passphrase message | n/a | n/a | ☐ | n/a |

The riskiest assumptions, in order:
1. The MEXC futures host: `api.mexc.com/api/v1/private`, as used by CCXT today.
2. KuCoin accepting `KC-API-KEY-VERSION: 2` for new (v3) keys. CCXT does this.
3. The exact MEXC `remainingValidity` semantics.

BingX offers a demo environment (`open-api-vst.bingx.com`, set via `BINGX_BASE_URL`) for early tests.

## Known limits
- KuCoin's API returns only about 3 months of futures trades. Older history will need CSV import (Phase 4).
- BingX rate-limits some endpoints to 1–3 requests per second **per server IP**, shared by all users. The Phase 4 sync scheduler must queue BingX calls globally, not just per user.

## Future improvements
- A periodic re-verification job marking revoked or expired keys INVALID, with an email before a MEXC key expires.
- KuCoin EU / other regional KuCoin sites, if users need them (different hosts).
