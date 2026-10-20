/** Market constants and formatting shared by server and client code (no browser APIs). */

export const LIVE_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "12h",
  "1d",
  "1w",
] as const;
export type LiveInterval = (typeof LIVE_INTERVALS)[number];

/** The timeframes shown as buttons; the rest are in the "more" menu. */
export const QUICK_INTERVALS: readonly LiveInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** Candle length in seconds. Binance aligns these to UTC (weeks open Monday 00:00 UTC). */
export const INTERVAL_SECONDS: Record<LiveInterval, number> = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "2h": 7200,
  "4h": 14_400,
  "6h": 21_600,
  "12h": 43_200,
  "1d": 86_400,
  "1w": 604_800,
};

/** Non-crypto perpetuals Binance lists under TradFi, with a friendly name. */
export const TRADFI_NAMES: Record<string, string> = {
  XAUUSDT: "Gold",
  XAGUSDT: "Silver",
};

/** "BTC/USDT", or "Gold · XAU/USDT" for TradFi perpetuals. */
export function symbolLabel(symbol: string): string {
  const pair = `${symbol.replace(/USDT$/, "")}/USDT`;
  const name = TRADFI_NAMES[symbol];
  return name ? `${name} · ${pair}` : pair;
}

export interface LiveCandle {
  /** Open time, seconds (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base-asset volume. */
  volume: number;
  /** Close time, ms (UTC): the end of the candle, for the countdown. */
  closeTime: number;
}

export { formatPrice } from "@atc/shared";

export const formatChange = (c: number) => {
  const pct = Number((c * 100).toFixed(2));
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}%`;
};
