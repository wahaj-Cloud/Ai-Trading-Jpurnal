import { z } from "zod";
import type { DeltaCandle, FlowStrength, OrderflowWindow, Regime } from "./orderflow.js";

/**
 * Scalping desk: every coin's flow on every timeframe at once (5m … 1D), how busy it is against
 * normal, where price sits against today's VWAP and how the order book is stacked near price.
 * Descriptive only: it shows what traders are doing, never what to do.
 */

export const SCALP_KEY = "scalp:latest";
/** Always scanned and shown on every plan, whatever their volume rank: gold and silver. */
export const SCALP_PINNED = ["XAUUSDT", "XAGUSDT"] as const;
export const isPinned = (symbol: string) => (SCALP_PINNED as readonly string[]).includes(symbol);
/** Coins whose order book is read each minute (the most traded). */
export const SCALP_BOOK_COINS = 20;
/** Distance bands from the mid price, in %. */
export const BOOK_BANDS = [0.05, 0.1, 0.25, 0.5, 1] as const;
/** A level at least this many times the median level size near price counts as a wall. */
export const WALL_MULTIPLE = 5;

export interface ScalpFrameDto {
  strength: FlowStrength;
  buyPressurePct: number;
  netFlowUsd: number;
  priceChangePct: number;
  oiChangePct: number | null;
  relVolume: number | null;
  regime: Regime;
}

export interface BookBandDto {
  pct: number;
  bidUsd: number;
  askUsd: number;
  /** (bids − asks) ÷ (bids + asks) × 100: +100 only bids, −100 only asks. */
  imbalancePct: number;
}

export interface BookWallDto {
  side: "bid" | "ask";
  price: number;
  usd: number;
  distPct: number;
  /** Times the median level size within the covered range. */
  multiple: number;
}

export interface BookDto {
  asOf: string;
  mid: number;
  spreadBps: number;
  /** Bands the fetched book reaches on both sides (deep books only reach the nearer ones). */
  bands: BookBandDto[];
  walls: BookWallDto[];
}

/** Price levels scalpers watch, all from candles since 00:00 UTC unless named otherwise. */
export interface ScalpLevelsDto {
  dayHigh: number;
  dayLow: number;
  /** Asia session (00:00–07:00 UTC) high and low; null before it starts. */
  asiaHigh: number | null;
  asiaLow: number | null;
  /** True while the Asia session is still running (the range can still grow). */
  asiaOpen: boolean;
  /** Last 24 hours. */
  high24h: number;
  low24h: number;
}

export const ACTIVITY = ["quiet", "normal", "active", "very_active"] as const;
export type Activity = (typeof ACTIVITY)[number];
export const ACTIVITY_LABEL: Record<Activity, string> = {
  quiet: "Quiet",
  normal: "Normal",
  active: "Active",
  very_active: "Very active",
};

/** How far price typically moves per candle (ATR, price units), and how lively it is now. */
export interface ScalpVolatilityDto {
  atr5m: number | null;
  atr15m: number | null;
  atr1h: number | null;
  /** Average 5-minute range of the last 30 minutes ÷ that of the last 4 hours. */
  rangeRatio: number | null;
  activity: Activity | null;
}

export interface ScalpCoinDto {
  symbol: string;
  rank: number;
  price: number;
  /** Today's volume-weighted average price (from 00:00 UTC) and price's distance from it, %. */
  vwap: number | null;
  vwapDistPct: number | null;
  funding: number | null;
  frames: Partial<Record<OrderflowWindow, ScalpFrameDto>>;
  book: BookDto | null;
  levels: ScalpLevelsDto | null;
  volatility: ScalpVolatilityDto;
}

/** A high-impact release that matters for a scalp: just out, or coming up. */
export interface ScalpEventDto {
  title: string;
  currency: string;
  startsAt: string;
}

export interface ScalpSnapshot {
  computedAt: string;
  /** Close of the newest 1-minute candle used. */
  asOf: string;
  universe: number;
  coins: ScalpCoinDto[];
}

export interface ScalpResponse extends Omit<ScalpSnapshot, "computedAt" | "asOf"> {
  /** High-impact USD releases from 15 minutes ago to 4 hours ahead, soonest first. */
  events: ScalpEventDto[];
  computedAt: string | null;
  asOf: string | null;
  limit: number | null;
  hidden: number;
  mine: string[];
}

export const scalpQuerySchema = z.object({}).strict();

export const SCALP_DISCLAIMER =
  "Binance USDⓈ-M futures public data. 5m–1H refresh every minute, 4H and 1D every 5 minutes; order books of the 20 most traded coins every minute. Strength describes how one-sided market orders were; it is not a forecast or a signal.";

// ─── Order book ───

type Level = readonly [price: number, qty: number];

/**
 * Pressure in a futures order book: dollar value resting within each band of the mid price on
 * each side, the spread, and unusually large levels (walls). Bids best-first (descending), asks
 * best-first (ascending). Null when either side is empty or crossed.
 */
export function bookPressure(
  bids: readonly Level[],
  asks: readonly Level[],
  at: Date,
): BookDto | null {
  const bestBid = bids[0]?.[0];
  const bestAsk = asks[0]?.[0];
  if (!bestBid || !bestAsk || !(bestBid > 0) || bestAsk <= bestBid) return null;
  const mid = (bestBid + bestAsk) / 2;
  const deepestBid = bids.at(-1)?.[0] ?? bestBid;
  const deepestAsk = asks.at(-1)?.[0] ?? bestAsk;
  // How far from mid the fetched book reaches on both sides.
  const reach = Math.min((1 - deepestBid / mid) * 100, (deepestAsk / mid - 1) * 100);
  const sum = (levels: readonly Level[], inside: (p: number) => boolean) =>
    levels.reduce((s, [p, q]) => (inside(p) ? s + p * q : s), 0);
  const bands: BookBandDto[] = [];
  for (const pct of BOOK_BANDS) {
    if (pct > reach + 1e-9) break;
    const bidUsd = sum(bids, (p) => p >= mid * (1 - pct / 100));
    const askUsd = sum(asks, (p) => p <= mid * (1 + pct / 100));
    const total = bidUsd + askUsd;
    bands.push({
      pct,
      bidUsd,
      askUsd,
      imbalancePct: total > 0 ? ((bidUsd - askUsd) / total) * 100 : 0,
    });
  }
  // Walls: within the covered range (max 1%), levels far bigger than the median level.
  const range = Math.min(1, reach);
  const near = [
    ...bids
      .filter(([p]) => p >= mid * (1 - range / 100))
      .map(([p, q]) => ({ side: "bid" as const, price: p, usd: p * q })),
    ...asks
      .filter(([p]) => p <= mid * (1 + range / 100))
      .map(([p, q]) => ({ side: "ask" as const, price: p, usd: p * q })),
  ];
  const sizes = near.map((l) => l.usd).sort((a, b) => a - b);
  const median = sizes.length ? (sizes[Math.floor((sizes.length - 1) / 2)] as number) : 0;
  const walls: BookWallDto[] = [];
  if (median > 0) {
    for (const side of ["bid", "ask"] as const) {
      walls.push(
        ...near
          .filter((l) => l.side === side && l.usd >= WALL_MULTIPLE * median)
          .sort((a, b) => b.usd - a.usd)
          .slice(0, 2)
          .map((l) => ({
            ...l,
            distPct: Math.abs(l.price / mid - 1) * 100,
            multiple: l.usd / median,
          })),
      );
    }
  }
  return {
    asOf: at.toISOString(),
    mid,
    spreadBps: ((bestAsk - bestBid) / mid) * 10_000,
    bands,
    walls,
  };
}

/** How many of the short timeframes (5m, 15m, 30m, 1H) lean each way. */
export function shortTermAlignment(frames: ScalpCoinDto["frames"]): {
  buying: number;
  selling: number;
  of: number;
} {
  let buying = 0;
  let selling = 0;
  let of = 0;
  for (const w of ["5m", "15m", "30m", "1h"] as const) {
    const f = frames[w];
    if (!f) continue;
    of++;
    if (f.strength === "buying" || f.strength === "strong_buying") buying++;
    if (f.strength === "selling" || f.strength === "strong_selling") selling++;
  }
  return { buying, selling, of };
}

// ─── Volatility and levels ───

const hi = (c: DeltaCandle) => c.h ?? Math.max(c.o, c.c);
const lo = (c: DeltaCandle) => c.l ?? Math.min(c.o, c.c);

/** Joins candles into bars of `size` × their length, aligned to the bar boundary; only full bars. */
export function aggregate(candles: readonly DeltaCandle[], candleMs: number, size: number) {
  const barMs = candleMs * size;
  const groups = new Map<number, DeltaCandle[]>();
  for (const c of candles) {
    const k = Math.floor(c.t / barMs) * barMs;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.length === size)
    .sort((a, b) => a[0] - b[0])
    .map(([t, g]) => {
      const sorted = [...g].sort((a, b) => a.t - b.t);
      return {
        t,
        o: (sorted[0] as DeltaCandle).o,
        c: (sorted.at(-1) as DeltaCandle).c,
        h: Math.max(...g.map(hi)),
        l: Math.min(...g.map(lo)),
      };
    });
}

/** True ranges of consecutive bars (the first bar has none). */
export function trueRanges(bars: ReadonlyArray<{ h: number; l: number; c: number }>): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i] as { h: number; l: number };
    const prev = (bars[i - 1] as { c: number }).c;
    out.push(Math.max(b.h - b.l, Math.abs(b.h - prev), Math.abs(b.l - prev)));
  }
  return out;
}

/** Average true range of the last `n` bars (simple average); null with fewer bars. */
export function atr(bars: ReadonlyArray<{ h: number; l: number; c: number }>, n = 14) {
  const tr = trueRanges(bars);
  if (tr.length < n) return null;
  return tr.slice(-n).reduce((s, v) => s + v, 0) / n;
}

/** Ratio thresholds of recent range to usual range. */
export function classifyActivity(ratio: number): Activity {
  return ratio < 0.7 ? "quiet" : ratio < 1.3 ? "normal" : ratio < 2 ? "active" : "very_active";
}

/** From 1-minute candles (4 hours): 5m and 15m ATR and how the last 30 minutes compare. */
export function shortVolatility(m1: readonly DeltaCandle[]): Omit<ScalpVolatilityDto, "atr1h"> {
  const b5 = aggregate(m1, 60_000, 5);
  const b15 = aggregate(m1, 60_000, 15);
  const tr5 = trueRanges(b5);
  let rangeRatio: number | null = null;
  if (tr5.length >= 24) {
    const recent = tr5.slice(-6).reduce((s, v) => s + v, 0) / 6;
    const usual = tr5.reduce((s, v) => s + v, 0) / tr5.length;
    if (usual > 0) rangeRatio = recent / usual;
  }
  return {
    atr5m: atr(b5),
    atr15m: atr(b15),
    rangeRatio,
    activity: rangeRatio === null ? null : classifyActivity(rangeRatio),
  };
}

const DAY = 86_400_000;
const ASIA_END_MS = 7 * 3_600_000;

/** Day, Asia-session and 24-hour highs and lows from candles of any size (oldest first). */
export function scalpLevels(candles: readonly DeltaCandle[], now: number): ScalpLevelsDto | null {
  const dayStart = Math.floor(now / DAY) * DAY;
  const today = candles.filter((c) => c.t >= dayStart);
  const last24 = candles.filter((c) => c.t >= now - DAY);
  if (!today.length || !last24.length) return null;
  const asia = today.filter((c) => c.t < dayStart + ASIA_END_MS);
  return {
    dayHigh: Math.max(...today.map(hi)),
    dayLow: Math.min(...today.map(lo)),
    asiaHigh: asia.length ? Math.max(...asia.map(hi)) : null,
    asiaLow: asia.length ? Math.min(...asia.map(lo)) : null,
    asiaOpen: now < dayStart + ASIA_END_MS,
    high24h: Math.max(...last24.map(hi)),
    low24h: Math.min(...last24.map(lo)),
  };
}

/** Joins two level readings of the same day (5-minute scan plus fresher 1-minute candles). */
export function mergeLevels(
  a: ScalpLevelsDto | null,
  b: ScalpLevelsDto | null,
): ScalpLevelsDto | null {
  if (!a || !b) return a ?? b;
  const max = (x: number | null, y: number | null) =>
    x === null ? y : y === null ? x : Math.max(x, y);
  const min = (x: number | null, y: number | null) =>
    x === null ? y : y === null ? x : Math.min(x, y);
  return {
    dayHigh: Math.max(a.dayHigh, b.dayHigh),
    dayLow: Math.min(a.dayLow, b.dayLow),
    asiaHigh: max(a.asiaHigh, b.asiaHigh),
    asiaLow: min(a.asiaLow, b.asiaLow),
    asiaOpen: b.asiaOpen,
    high24h: Math.max(a.high24h, b.high24h),
    low24h: Math.min(a.low24h, b.low24h),
  };
}

/** The trading session at a moment (same hours as the analytics sessions). */
export function sessionAt(now: Date): {
  id: "ASIA" | "LONDON" | "NEW_YORK" | "OFF_HOURS";
  label: string;
} {
  const h = now.getUTCHours();
  if (h < 7) return { id: "ASIA", label: "Asia" };
  if (h < 13) return { id: "LONDON", label: "London" };
  if (h < 21)
    return {
      id: "NEW_YORK",
      label: h < 16 ? "New York (London overlap until 16:00 UTC)" : "New York",
    };
  return { id: "OFF_HOURS", label: "Off-hours" };
}
