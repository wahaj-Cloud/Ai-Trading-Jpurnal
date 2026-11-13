import { z } from "zod";

/**
 * Closed candles for a coin's card in Order Flow, served through our API (cached in Redis until the
 * next candle closes) so the card works where Binance refuses visitors. The same candles the
 * browser would fetch from Binance itself.
 */

export const CARD_TFS = ["15m", "1h", "4h"] as const;
export type CardTf = (typeof CARD_TFS)[number];
export const CARD_CANDLES: Record<CardTf, number> = { "15m": 300, "1h": 1000, "4h": 1000 };
export const CARD_TF_MS: Record<CardTf, number> = {
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
};

/** One candle: open time (ms), open, high, low, close, volume. */
export type CandleRow = [t: number, o: number, h: number, l: number, c: number, v: number];

export interface CoinCandlesDto {
  symbol: string;
  candles: Record<CardTf, CandleRow[]>;
}

export const coinCandlesSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}USDT$/);

/**
 * How long a timeframe's candles stay current: until a few seconds after the next candle closes
 * (Binance needs a moment to publish it), never less than 5 seconds.
 */
export function cardCandlesTtlMs(tf: CardTf, now: number, graceMs = 3_000): number {
  const step = CARD_TF_MS[tf];
  const nextClose = Math.floor(now / step) * step + step;
  return Math.max(5_000, nextClose + graceMs - now);
}
