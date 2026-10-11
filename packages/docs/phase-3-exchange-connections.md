# Phase 3 — Exchange Connections

## Purpose
Let traders connect Binance USDⓈ-M Futures with a read-only API key that is verified, encrypted and fully
under their control (replace, disconnect). Foundation for automatic trade sync (Phase 4).

## Architecture
```
Browser ─form─> Next.js server action ─PUT/POST─> API ──verify──> Binance (read-only calls)
                                                   │
                                                   ├─ seal (envelope encryption) ─> exchange_credentials
                                                   └─ audit log (never key material)
```
Verification order (fails fast, stores nothing on failure):
1. `GET /sapi/v1/account/apiRestrictions` — reading must be on; **any other permission flag on = rejected**,
   including flags Binance adds later (safe by default). Rejection lists the exact settings to switch off.
2. `GET /api/v3/account` — Binance UID, used for duplicate detection and reconnect integrity.
3. `GET /fapi/v1/income?limit=1` — proves USDⓈ-M Futures read access.

Encryption: a fresh 256-bit data key per connection encrypts API key and secret (AES-256-GCM, bound to
account ID + field name). The data key is wrapped by the master key (`CREDENTIAL_KEYS`, HKDF-derived,
versioned for rotation). The API only ever encrypts; decryption is for the sync worker (Phase 4).

## Files created / modified
| Area | Path |
|---|---|
| Crypto | `packages/crypto/src/{key-ring,vault}.ts` (+ tests) |
| Exchange adapters | `packages/exchange-adapters/src/{types,registry}.ts`, `binance/{client,signing,permissions,adapter}.ts` (+ tests) |
| Shared | `packages/shared/src/exchanges.ts` |
| Database | `schema.prisma`, migration `20260927000000_exchange_connections` |
| API | `apps/api/src/exchange-accounts/*`, `config/env.ts`, `users/users.service.ts`, `app.module.ts`, `test/*` |
| Web | `app/(app)/exchanges/**`, `features/exchanges/*`, `features/dashboard/setup-runway.tsx`, `components/shell/nav-config.ts`, `lib/api.ts` |
| CI / docs | `.github/workflows/ci.yml`, `README.md`, `docs/architecture.md` |

## Database changes
- Enums `Exchange` (BINANCE, MEXC), `ExchangeAccountStatus` (ACTIVE, INVALID, DISCONNECTED).
- `exchange_accounts`: one row per connected exchange account; unique `(user_id, exchange, external_account_id)`.
- `exchange_credentials`: 1:1, ciphertext only, deleted immediately on disconnect.

## API endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/exchange-accounts` | Connections, plan usage, IPs to whitelist |
| POST | `/v1/exchange-accounts` | Verify + connect (10/min/IP) |
| PUT | `/v1/exchange-accounts/:id/credentials` | Replace key; must be the same exchange account (10/min/IP) |
| DELETE | `/v1/exchange-accounts/:id` | Disconnect: delete key, keep history |

Errors: 422 (fixable by user, with `issues` listing permissions to turn off), 403 (plan limit), 409 (already
connected), 429 (exchange rate limit), 503 (exchange unreachable / region blocked).

## Testing
34 unit tests (signing matches Binance's published vector, permission rules, error mapping, crypto tamper and
rotation cases, schemas) + an integration suite against Postgres and a signature-checking fake Binance,
run in CI.

## Not verifiable before deployment
Calls to the real Binance API (my build environment cannot reach it). First live test: connect a real
read-only key after deployment.

## Future improvements
- Periodic re-verification job marking revoked keys `INVALID` (Phase 4 worker).
- AWS KMS master key; admin re-wrap job for master-key rotation.
- Per-user (not per-IP) throttling on verification endpoints.
- MEXC adapter (Phase 4, after checking whether its API exposes key permissions).
