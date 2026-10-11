# Phase 7 — Strategy analysis

## Purpose
Judge each entry against the market as it was: trend, EMAs, VWAP, RSI, volume, support/resistance,
liquidity, fair value gaps, order/breaker/mitigation blocks, BOS/CHOCH, premium/discount zones and
entry/exit confirmation.

## Architecture
- `packages/ta` — pure indicator and market-structure functions. `analyzeTrade` picks a timeframe from
  the holding time, loads 250 warm-up candles and uses only candles closed before entry (no
  look-ahead).
- `packages/exchange-adapters/src/market/candles.ts` — public kline endpoints for Binance, MEXC,
  KuCoin and BingX, behind the shared rate limiter.
- `packages/coach/src/context.ts` — caches results in `trade_contexts`. When the exchange has no
  candles, the trade is marked UNAVAILABLE and never retried in a loop. It adds market-based
  behaviour flags (for example FOMO when the entry was extended) and aggregate "strategy insights".
- Web: context panel and "Analyse" button on the trade page, "Entry quality" on Analytics, and a
  `/help` glossary.

## Database changes
Migration `20261003000000_strategy_analysis`: `trade_contexts`.

## API endpoints
`POST /v1/positions/:id/context`, `GET /v1/coach/strategy`. Trade detail includes `context` and
`contextStatus`.

## Future improvements
Multi-timeframe confluence; user-defined strategy checklists scored automatically.
