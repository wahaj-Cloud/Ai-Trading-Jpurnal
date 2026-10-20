import { z } from "zod";

/**
 * Order Flow: for the most traded futures coins, which side is pushing (aggressive buying vs
 * selling), whether new money is entering or leaving (open interest) and how price responded.
 * Every number comes from Binance's public futures data and is a record of what happened, never a
 * forecast.
 *
 * Definitions (all over the chosen window):
 *  - Net taker flow ($): Σ (taker buy quote volume − taker sell quote volume) of 5-minute candles,
 *    where taker sell = quote volume − taker buy quote volume.
 *  - Buy pressure (%): net taker flow ÷ total quote volume × 100 (−100 all selling … +100 all buying).
 *  - Price change (%): last close ÷ first candle's open − 1.
 *  - Open interest change (%): contracts outstanding (in coins, so price moves don't distort it) at
 *    the end ÷ at the start − 1. In dollars: change in coins × last price.
 */

export const ORDERFLOW_WINDOWS = ["5m", "15m", "30m", "1h", "4h", "24h"] as const;
export type OrderflowWindow = (typeof ORDERFLOW_WINDOWS)[number];
export const ORDERFLOW_WINDOW_LABEL: Record<OrderflowWindow, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "24h": "1D",
};
/**
 * How each window is measured. Short windows come from the 1-minute scan (1-minute candles, live
 * open interest), long ones from the 5-minute scan (5-minute candles, Binance's 5-minute open
 * interest history).
 */
export const ORDERFLOW_SPEC: Record<
  OrderflowWindow,
  { tier: "fast" | "slow"; candleMs: number; candles: number }
> = {
  "5m": { tier: "fast", candleMs: 60_000, candles: 5 },
  "15m": { tier: "fast", candleMs: 60_000, candles: 15 },
  "30m": { tier: "fast", candleMs: 60_000, candles: 30 },
  "1h": { tier: "fast", candleMs: 60_000, candles: 60 },
  "4h": { tier: "slow", candleMs: 300_000, candles: 48 },
  "24h": { tier: "slow", candleMs: 300_000, candles: 288 },
};
export const FAST_WINDOWS = ORDERFLOW_WINDOWS.filter((w) => ORDERFLOW_SPEC[w].tier === "fast");
export const SLOW_WINDOWS = ORDERFLOW_WINDOWS.filter((w) => ORDERFLOW_SPEC[w].tier === "slow");
/** Candles of each tier the scans fetch: the longest window plus the volume baseline. */
export const FAST_LOOKBACK_CANDLES = 240; // 4 hours of 1-minute candles
export const SLOW_LOOKBACK_CANDLES = 288; // 24 hours of 5-minute candles
/** Moves smaller than these count as flat, so noise never decides a coin's group. */
export const ORDERFLOW_MIN_MOVE: Record<OrderflowWindow, { price: number; oi: number }> = {
  "5m": { price: 0.15, oi: 0.2 },
  "15m": { price: 0.2, oi: 0.3 },
  "30m": { price: 0.25, oi: 0.4 },
  "1h": { price: 0.3, oi: 0.5 },
  "4h": { price: 0.6, oi: 1 },
  "24h": { price: 1.5, oi: 2 },
};

/**
 * Flow strength: how one-sided taker trading was. Buy pressure (net taker ÷ volume) beyond the
 * first number is buying/selling, beyond the second strong buying/selling. Short windows need a
 * bigger imbalance, because a few minutes of trading swing more than a whole day does.
 */
export const STRENGTHS = [
  "strong_selling",
  "selling",
  "neutral",
  "buying",
  "strong_buying",
] as const;
export type FlowStrength = (typeof STRENGTHS)[number];
export const STRENGTH_LABEL: Record<FlowStrength, string> = {
  strong_selling: "Strong selling",
  selling: "Selling",
  neutral: "Neutral",
  buying: "Buying",
  strong_buying: "Strong buying",
};
export const STRENGTH_THRESHOLDS: Record<OrderflowWindow, { lean: number; strong: number }> = {
  "5m": { lean: 10, strong: 25 },
  "15m": { lean: 8, strong: 20 },
  "30m": { lean: 6, strong: 15 },
  "1h": { lean: 5, strong: 12 },
  "4h": { lean: 3, strong: 8 },
  "24h": { lean: 2, strong: 5 },
};
export function classifyStrength(buyPressurePct: number, window: OrderflowWindow): FlowStrength {
  const t = STRENGTH_THRESHOLDS[window];
  if (buyPressurePct >= t.strong) return "strong_buying";
  if (buyPressurePct >= t.lean) return "buying";
  if (buyPressurePct <= -t.strong) return "strong_selling";
  if (buyPressurePct <= -t.lean) return "selling";
  return "neutral";
}
/** Relative volume at or above this is flagged as unusual. */
export const UNUSUAL_VOLUME = 2.5;

export const ORDERFLOW_COINS = 100;
/** market_snapshots key of one window's latest scan. */
export const orderflowKey = (w: OrderflowWindow) => `orderflow:${w}`;
export const ORDERFLOW_SERIES_POINTS = 48;

export const REGIMES = [
  "long_buildup",
  "short_buildup",
  "short_covering",
  "long_unwinding",
  "neutral",
] as const;
export type Regime = (typeof REGIMES)[number];
export const REGIME_INFO: Record<Regime, { label: string; rule: string; meaning: string }> = {
  long_buildup: {
    label: "Long build-up",
    rule: "Price up, open interest up",
    meaning: "New positions are opening as price rises: fresh money is behind the move up.",
  },
  short_buildup: {
    label: "Short build-up",
    rule: "Price down, open interest up",
    meaning: "New positions are opening as price falls: fresh money is pressing the move down.",
  },
  short_covering: {
    label: "Short covering",
    rule: "Price up, open interest down",
    meaning: "Price rises while positions close: shorts buying back, not new buyers.",
  },
  long_unwinding: {
    label: "Long unwinding",
    rule: "Price down, open interest down",
    meaning: "Price falls while positions close: longs exiting, not new sellers.",
  },
  neutral: {
    label: "No clear flow",
    rule: "Price or open interest barely moved",
    meaning: "The move is too small to read.",
  },
};

export interface OrderflowCoinDto {
  symbol: string;
  /** Rank by 24h quote volume (1 = most traded). */
  rank: number;
  price: number;
  volumeUsd: number;
  priceChangePct: number;
  oiChangePct: number | null;
  oiChangeUsd: number | null;
  netFlowUsd: number;
  buyPressurePct: number;
  regime: Regime;
  strength: FlowStrength;
  /**
   * Traded value per candle in this window ÷ the average over the scan's lookback (4 hours for
   * windows up to 1H, 24 hours for 4H). 2 = twice the usual activity. Null for 1D.
   */
  relVolume: number | null;
  /** Funding rate for the next settlement (fraction), when known. */
  funding: number | null;
  /** Downsampled series from the window start (oldest first), in % from the start. */
  series: { pressure: number[]; price: number[]; oi: number[] | null };
}

export interface OrderflowWindowDto {
  window: OrderflowWindow;
  coins: OrderflowCoinDto[];
  counts: Record<Regime, number>;
  /** Coins with net buying / net selling over the window. */
  buying: number;
  selling: number;
  netFlowUsd: number;
}

/** One window as the worker saves it. */
export interface OrderflowWindowSnapshot extends OrderflowWindowDto {
  computedAt: string;
  /** Candle close the figures run to. */
  asOf: string;
  /** Contracts scanned. */
  universe: number;
}

/** One coin on one window, for the multi-timeframe matrix: buy pressure %, strength, group. */
export interface AcrossCell {
  p: number;
  s: FlowStrength;
  r: Regime;
}
/** symbol → window → cell; a window is missing when its scan is not current. */
export type OrderflowAcross = Record<string, Partial<Record<OrderflowWindow, AcrossCell>>>;

export interface OrderflowResponse extends OrderflowWindowDto {
  computedAt: string | null;
  asOf: string | null;
  universe: number;
  /** Coins this plan shows (others are counted but hidden); null = all. */
  limit: number | null;
  hidden: number;
  /** Symbols the trader holds right now, to highlight. */
  mine: string[];
  /** The shown coins on every window, from the scans current with this one. */
  across: OrderflowAcross;
}

export const orderflowQuerySchema = z
  .object({ window: z.enum(ORDERFLOW_WINDOWS).default("1h") })
  .strict();
export type OrderflowQuery = z.infer<typeof orderflowQuerySchema>;

export const ORDERFLOW_DISCLAIMER =
  "Binance USDⓈ-M futures public data, top coins by 24h volume, 5m to 1H refreshed every minute, 4H and 1D every 5 minutes. Taker flow is market orders that crossed the spread; open interest is in coins. A record of what happened, not a forecast or a signal.";

// ─── Calculations ───

export interface DeltaCandle {
  t: number;
  o: number;
  /** High and low (absent in older data: the body is used instead). */
  h?: number;
  l?: number;
  c: number;
  /** Base volume (coins), quote volume (USDT) and the part of it bought by takers. */
  base: number;
  quote: number;
  takerBuyQuote: number;
}

export function classifyRegime(
  priceChangePct: number,
  oiChangePct: number | null,
  window: OrderflowWindow,
): Regime {
  if (oiChangePct === null) return "neutral";
  const m = ORDERFLOW_MIN_MOVE[window];
  const p = priceChangePct >= m.price ? 1 : priceChangePct <= -m.price ? -1 : 0;
  const o = oiChangePct >= m.oi ? 1 : oiChangePct <= -m.oi ? -1 : 0;
  if (p === 0 || o === 0) return "neutral";
  if (o > 0) return p > 0 ? "long_buildup" : "short_buildup";
  return p > 0 ? "short_covering" : "long_unwinding";
}

/** Keeps at most `max` evenly spaced points, always including the last. */
export function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(values[Math.round(i * step)] as number);
  return out;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * One coin's figures for one window, from closed candles of the window's tier (oldest first,
 * including the lookback before the window) and open interest readings in coins (any order). Null
 * when fewer than 90% of the window's candles exist.
 */
export function orderflowMetrics(
  candles: readonly DeltaCandle[],
  oi: ReadonlyArray<{ t: number; oi: number }>,
  window: OrderflowWindow,
): Omit<OrderflowCoinDto, "symbol" | "rank" | "funding"> | null {
  const { candles: n, candleMs } = ORDERFLOW_SPEC[window];
  const w = candles.slice(-n);
  if (w.length < Math.ceil(n * 0.9)) return null;
  const first = w[0] as DeltaCandle;
  const last = w.at(-1) as DeltaCandle;
  if (!(first.o > 0) || !(last.c > 0)) return null;
  let volume = 0;
  let net = 0;
  const pressure: number[] = [];
  const price: number[] = [];
  for (const c of w) {
    volume += c.quote;
    net += 2 * c.takerBuyQuote - c.quote;
    pressure.push(volume > 0 ? (net / volume) * 100 : 0);
    price.push((c.c / first.o - 1) * 100);
  }
  // Open interest: the reading closest to the window start (within two candles) and the latest one
  // up to the window end.
  const tol = 2 * candleMs;
  const start = first.t;
  const end = last.t + candleMs;
  const sorted = [...oi].filter((p) => Number.isFinite(p.oi) && p.oi > 0).sort((a, b) => a.t - b.t);
  const s = sorted
    .filter((p) => Math.abs(p.t - start) <= tol)
    .sort((a, b) => Math.abs(a.t - start) - Math.abs(b.t - start))[0];
  const inWindow = sorted.filter((p) => p.t >= start - tol && p.t <= end);
  const e = inWindow.at(-1);
  let oiChangePct: number | null = null;
  let oiChangeUsd: number | null = null;
  let oiSeries: number[] | null = null;
  if (s && e && e.t > s.t) {
    oiChangePct = (e.oi / s.oi - 1) * 100;
    oiChangeUsd = (e.oi - s.oi) * last.c;
    oiSeries = inWindow.filter((p) => p.t >= s.t).map((p) => r3((p.oi / s.oi - 1) * 100));
  }
  const priceChangePct = (last.c / first.o - 1) * 100;
  const buyPressurePct = volume > 0 ? (net / volume) * 100 : 0;
  // Relative volume: this window's value per candle against the whole lookback's (which includes
  // the window), when the lookback is at least four windows long.
  let relVolume: number | null = null;
  if (window !== "24h" && candles.length >= 4 * w.length) {
    const all = candles.reduce((sum, c) => sum + c.quote, 0);
    const avg = all / candles.length;
    if (avg > 0) relVolume = volume / w.length / avg;
  }
  return {
    price: last.c,
    volumeUsd: volume,
    priceChangePct,
    oiChangePct,
    oiChangeUsd,
    netFlowUsd: net,
    buyPressurePct,
    regime: classifyRegime(priceChangePct, oiChangePct, window),
    strength: classifyStrength(buyPressurePct, window),
    relVolume,
    series: {
      pressure: downsample(pressure, ORDERFLOW_SERIES_POINTS).map(r3),
      price: downsample(price, ORDERFLOW_SERIES_POINTS).map(r3),
      oi: oiSeries ? downsample(oiSeries, ORDERFLOW_SERIES_POINTS) : null,
    },
  };
}

/** Counts and totals of a window's coins. */
export function summarizeWindow(
  window: OrderflowWindow,
  coins: OrderflowCoinDto[],
): OrderflowWindowDto {
  const counts = Object.fromEntries(REGIMES.map((r) => [r, 0])) as Record<Regime, number>;
  for (const c of coins) counts[c.regime]++;
  return {
    window,
    coins,
    counts,
    buying: coins.filter((c) => c.netFlowUsd > 0).length,
    selling: coins.filter((c) => c.netFlowUsd < 0).length,
    netFlowUsd: coins.reduce((s, c) => s + c.netFlowUsd, 0),
  };
}

/**
 * Volume-weighted average price since 00:00 UTC, exact from each candle's quote ÷ base volume.
 * Null before the first candle of the day closes.
 */
export function dayVwap(candles: readonly DeltaCandle[], now: number): number | null {
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  let quote = 0;
  let base = 0;
  for (const c of candles) {
    if (c.t < dayStart) continue;
    quote += c.quote;
    base += c.base;
  }
  return base > 0 ? quote / base : null;
}
