import { z } from "zod";
import {
  type DeltaCandle,
  downsample,
  FAST_LOOKBACK_CANDLES,
  type FlowStrength,
  ORDERFLOW_WINDOWS,
  type OrderflowAcross,
  type OrderflowCoinDto,
  type OrderflowWindow,
  orderflowMetrics,
  REGIMES,
  type Regime,
} from "./orderflow.js";
import {
  type Activity,
  aggregate,
  atr,
  classifyActivity,
  isPinned,
  type ScalpCoinDto,
  trueRanges,
} from "./scalp.js";

/**
 * Live order flow: the 5m, 15m, 30m and 1H windows recalculated every second from Binance's live
 * 1-minute candle stream (the candle still forming counts as the newest of the window), open
 * interest polled every 5 seconds (top coins, gold, silver) or 15 seconds (the rest), funding from
 * the mark-price stream and the spread from the best bid and ask.
 *
 * Every figure uses the same definitions as the 1-minute scan (`orderflowMetrics`), so a live
 * number and a minute number differ only by the trading since the last closed minute.
 */

export const LIVE_WINDOWS = [
  "5m",
  "15m",
  "30m",
  "1h",
] as const satisfies readonly OrderflowWindow[];
export type LiveWindow = (typeof LIVE_WINDOWS)[number];
export const isLiveWindow = (w: string): w is LiveWindow =>
  (LIVE_WINDOWS as readonly string[]).includes(w);

/** Redis pub/sub channel and key of the latest tick (worker → API). */
export const LIVE_FLOW_CHANNEL = "live:flow";
export const LIVE_FLOW_KEY = "live:flow:latest";
/** Set by the live engine every tick: while it exists, scalp alerts are checked live. */
export const LIVE_ALIVE_KEY = "liveflow:alive";
/** How often the engine publishes. */
export const LIVE_TICK_MS = 1_000;
/** Open interest polling: top coins (and gold, silver) and the rest. */
export const LIVE_OI_FAST_MS = 5_000;
export const LIVE_OI_SLOW_MS = 15_000;
export const LIVE_OI_FAST_COINS = 20;
/** Points kept in each live pressure series (enough for the flow lines, small to send). */
export const LIVE_SERIES_POINTS = 30;
/** A tick older than this is shown as delayed. */
export const LIVE_STALE_MS = 10_000;

/** One coin on one window, live. Short keys: this is sent every second. */
export interface LiveCell {
  /** Buy pressure %, net taker flow $, traded value $, price change %. */
  bp: number;
  nf: number;
  vol: number;
  pc: number;
  /** Open interest change % and $ (null without readings at both ends). */
  oi: number | null;
  oiu: number | null;
  rg: Regime;
  st: FlowStrength;
  /** Trading pace against the usual pace (minutes elapsed in the window counted exactly). */
  rv: number | null;
  /** Cumulative buy pressure through the window (only sent where a page draws it). */
  ser?: number[];
}

export interface LiveVolatility {
  atr5m: number | null;
  atr15m: number | null;
  /** Average 5-minute range of the last 30 minutes (the current bar so far included) ÷ usual. */
  rangeRatio: number | null;
  activity: Activity | null;
}

export interface LiveCoin {
  s: string;
  /** Rank by 24h volume. */
  r: number;
  /** Last price, and the forming minute's high and low. */
  p: number;
  h: number;
  l: number;
  /** Funding rate for the next settlement (fraction). */
  f: number | null;
  /** Spread in basis points from the best bid and ask (top coins, gold, silver). */
  sp: number | null;
  v: LiveVolatility;
  w: Partial<Record<LiveWindow, LiveCell>>;
  /** Time of the newest market event for this coin (ms). */
  t: number;
}

export interface LiveSummary {
  buying: number;
  selling: number;
  netFlowUsd: number;
  counts: Record<Regime, number>;
}

export interface LiveTick {
  /** When the engine computed this tick (ms). */
  at: number;
  universe: number;
  coins: LiveCoin[];
  summary: Record<LiveWindow, LiveSummary>;
}

// ─── Calculations ───

/**
 * Live volatility from 1-minute candles: ATR of full 5- and 15-minute bars (closed candles only, as
 * in the minute scan), and the activity ratio with the current 5-minute bar counted as it stands,
 * so a sudden burst shows within seconds instead of at the end of the bar.
 */
export function liveVolatility(
  closed: readonly DeltaCandle[],
  forming: DeltaCandle | null,
): LiveVolatility {
  const all = forming ? [...closed, forming] : [...closed];
  const b5 = aggregate(closed, 60_000, 5);
  const b15 = aggregate(closed, 60_000, 15);
  const usualTr = trueRanges(b5);
  let rangeRatio: number | null = null;
  const last = all.at(-1);
  if (usualTr.length >= 24 && last) {
    const barStart = Math.floor(last.t / 300_000) * 300_000;
    const inBar = all.filter((c) => c.t >= barStart);
    const fullBars = b5.filter((b) => b.t < barStart);
    const prev = fullBars.at(-1);
    const cur = {
      t: barStart,
      o: (inBar[0] as DeltaCandle).o,
      c: last.c,
      h: Math.max(...inBar.map((c) => c.h ?? Math.max(c.o, c.c))),
      l: Math.min(...inBar.map((c) => c.l ?? Math.min(c.o, c.c))),
    };
    // The last five full bars plus the current one: the last 30 minutes.
    const recentBars = prev ? [...fullBars.slice(-6), cur] : [cur];
    const recent = trueRanges(recentBars);
    const usual = usualTr.reduce((s, v) => s + v, 0) / usualTr.length;
    if (recent.length > 0 && usual > 0)
      rangeRatio = recent.reduce((s, v) => s + v, 0) / recent.length / usual;
  }
  return {
    atr5m: atr(b5),
    atr15m: atr(b15),
    rangeRatio,
    activity: rangeRatio === null ? null : classifyActivity(rangeRatio),
  };
}

export interface LiveCoinInput {
  symbol: string;
  rank: number;
  /** Closed 1-minute candles, oldest first (up to the 4-hour lookback). */
  closed: readonly DeltaCandle[];
  /** The 1-minute candle still forming, when the stream has one newer than the last closed. */
  forming: DeltaCandle | null;
  /** Open interest readings in coins. */
  oi: ReadonlyArray<{ t: number; oi: number }>;
  funding: number | null;
  spreadBps: number | null;
  /** Newest market event for the coin, and now (ms). */
  updatedAt: number;
  now: number;
  /** Series points per window (null: none). */
  series?: number;
}

/**
 * One coin's live figures. Each window is the last N one-minute candles counting the forming one,
 * read by `orderflowMetrics`. Relative volume divides by the minutes actually elapsed (N − 1 full
 * minutes plus the forming minute's share) and compares with the average closed minute of the
 * lookback, so it does not dip at the start of every minute.
 */
export function liveCoin(x: LiveCoinInput): LiveCoin | null {
  const closed = x.closed.slice(-FAST_LOOKBACK_CANDLES);
  const forming =
    x.forming && (closed.length === 0 || x.forming.t > (closed.at(-1) as DeltaCandle).t)
      ? x.forming
      : null;
  const candles = forming ? [...closed, forming] : closed;
  const last = candles.at(-1);
  if (!last) return null;
  const avgClosed = closed.length ? closed.reduce((s, c) => s + c.quote, 0) / closed.length : 0;
  const elapsed = forming ? Math.min(1, Math.max(1 / 60, (x.now - forming.t) / 60_000)) : 1;
  const w: Partial<Record<LiveWindow, LiveCell>> = {};
  for (const win of LIVE_WINDOWS) {
    const m = orderflowMetrics(candles, x.oi, win);
    if (!m) continue;
    const n = Math.min(candles.length, windowCandles(win));
    const minutes = forming ? n - 1 + elapsed : n;
    const rv =
      closed.length >= 4 * windowCandles(win) && avgClosed > 0
        ? m.volumeUsd / minutes / avgClosed
        : null;
    w[win] = {
      bp: m.buyPressurePct,
      nf: m.netFlowUsd,
      vol: m.volumeUsd,
      pc: m.priceChangePct,
      oi: m.oiChangePct,
      oiu: m.oiChangeUsd,
      rg: m.regime,
      st: m.strength,
      rv,
      ...(x.series ? { ser: downsample(m.series.pressure, x.series) } : {}),
    };
  }
  return {
    s: x.symbol,
    r: x.rank,
    p: last.c,
    h: last.h ?? Math.max(last.o, last.c),
    l: last.l ?? Math.min(last.o, last.c),
    f: x.funding,
    sp: x.spreadBps,
    v: liveVolatility(closed, forming),
    w,
    t: x.updatedAt,
  };
}

const windowCandles = (w: LiveWindow) => ({ "5m": 5, "15m": 15, "30m": 30, "1h": 60 })[w];

/** Market-wide counts per window, over every coin in the tick. */
export function summarizeLive(coins: readonly LiveCoin[]): Record<LiveWindow, LiveSummary> {
  const out = {} as Record<LiveWindow, LiveSummary>;
  for (const w of LIVE_WINDOWS) {
    const counts = Object.fromEntries(REGIMES.map((r) => [r, 0])) as Record<Regime, number>;
    let buying = 0;
    let selling = 0;
    let net = 0;
    for (const c of coins) {
      const cell = c.w[w];
      if (!cell) continue;
      counts[cell.rg]++;
      if (cell.nf > 0) buying++;
      else if (cell.nf < 0) selling++;
      net += cell.nf;
    }
    out[w] = { buying, selling, netFlowUsd: net, counts };
  }
  return out;
}

// ─── Applying a tick to the pages' data ───

/** A Scalping / Cockpit coin with the live figures in place (book bands stay per minute). */
export function applyLiveToScalpCoin(coin: ScalpCoinDto, live: LiveCoin): ScalpCoinDto {
  const frames = { ...coin.frames };
  for (const w of LIVE_WINDOWS) {
    const c = live.w[w];
    if (!c) continue;
    frames[w] = {
      strength: c.st,
      buyPressurePct: c.bp,
      netFlowUsd: c.nf,
      priceChangePct: c.pc,
      oiChangePct: c.oi,
      relVolume: c.rv,
      regime: c.rg,
    };
  }
  const L = coin.levels;
  const levels = L
    ? {
        ...L,
        // Today's and the last 24 hours' extremes move with the live candle.
        dayHigh: Math.max(L.dayHigh, live.h),
        dayLow: Math.min(L.dayLow, live.l),
        high24h: Math.max(L.high24h, live.h),
        low24h: Math.min(L.low24h, live.l),
        ...(L.asiaOpen
          ? {
              asiaHigh: L.asiaHigh === null ? live.h : Math.max(L.asiaHigh, live.h),
              asiaLow: L.asiaLow === null ? live.l : Math.min(L.asiaLow, live.l),
            }
          : {}),
      }
    : null;
  return {
    ...coin,
    price: live.p,
    vwapDistPct: coin.vwap && coin.vwap > 0 ? (live.p / coin.vwap - 1) * 100 : null,
    funding: live.f ?? coin.funding,
    frames,
    book: coin.book && live.sp !== null ? { ...coin.book, spreadBps: live.sp } : coin.book,
    levels,
    volatility: {
      ...coin.volatility,
      atr5m: live.v.atr5m ?? coin.volatility.atr5m,
      atr15m: live.v.atr15m ?? coin.volatility.atr15m,
      rangeRatio: live.v.rangeRatio,
      activity: live.v.activity,
    },
  };
}

/** An Order Flow coin with one live window applied (the page's chosen window). */
export function applyLiveToOrderflowCoin(
  coin: OrderflowCoinDto,
  live: LiveCoin,
  window: OrderflowWindow,
): OrderflowCoinDto {
  const c = isLiveWindow(window) ? live.w[window] : undefined;
  if (!c) return { ...coin, price: live.p, funding: live.f ?? coin.funding };
  return {
    ...coin,
    price: live.p,
    funding: live.f ?? coin.funding,
    volumeUsd: c.vol,
    priceChangePct: c.pc,
    oiChangePct: c.oi,
    oiChangeUsd: c.oiu,
    netFlowUsd: c.nf,
    buyPressurePct: c.bp,
    regime: c.rg,
    strength: c.st,
    relVolume: c.rv,
    series: { ...coin.series, pressure: c.ser ?? coin.series.pressure },
  };
}

/** The multi-timeframe matrix with the live windows replaced. */
export function applyLiveToAcross(
  across: OrderflowAcross,
  coins: readonly LiveCoin[],
): OrderflowAcross {
  const out: OrderflowAcross = { ...across };
  for (const live of coins) {
    if (!out[live.s]) continue;
    const cells = { ...out[live.s] };
    for (const w of LIVE_WINDOWS) {
      const c = live.w[w];
      if (c) cells[w] = { p: c.bp, s: c.st, r: c.rg };
    }
    out[live.s] = cells;
  }
  return out;
}

// ─── What one browser receives ───

export const LIVE_VIEWS = ["orderflow", "scalp", "cockpit"] as const;
export type LiveViewKind = (typeof LIVE_VIEWS)[number];

export const liveStreamQuerySchema = z
  .object({
    ticket: z.string().regex(/^[a-f0-9]{48}$/),
    view: z.enum(LIVE_VIEWS),
    w: z.enum(ORDERFLOW_WINDOWS).optional(),
    s: z
      .string()
      .regex(/^[A-Z0-9]{2,30}$/)
      .optional(),
  })
  .strict();
export type LiveStreamQuery = z.infer<typeof liveStreamQuerySchema>;

export interface LiveTicketDto {
  ticket: string;
  expiresAt: string;
}

export interface LiveView {
  at: number;
  /** Market-wide counts of the chosen window (Order Flow only). */
  summary: LiveSummary | null;
  coins: LiveCoin[];
}

/**
 * The part of a tick one page needs, within the plan: coins ranked within `cap` (gold and silver
 * always), one symbol for the Cockpit, and the flow-line series only for the Order Flow window.
 */
export function liveViewOf(
  tick: LiveTick,
  q: { view: LiveViewKind; w?: OrderflowWindow; s?: string },
  cap: number | null,
): LiveView {
  const allowed = (c: LiveCoin) => cap === null || c.r <= cap || isPinned(c.s);
  const strip = (c: LiveCoin, keep: LiveWindow | null): LiveCoin => {
    const w: LiveCoin["w"] = {};
    for (const k of LIVE_WINDOWS) {
      const cell = c.w[k];
      if (!cell) continue;
      if (k === keep) w[k] = cell;
      else {
        const { ser: _drop, ...rest } = cell;
        w[k] = rest;
      }
    }
    return { ...c, w };
  };
  if (q.view === "cockpit") {
    const c = tick.coins.find((x) => x.s === q.s && allowed(x));
    return { at: tick.at, summary: null, coins: c ? [strip(c, null)] : [] };
  }
  const keep = q.view === "orderflow" && q.w && isLiveWindow(q.w) ? q.w : null;
  return {
    at: tick.at,
    summary: keep ? tick.summary[keep] : null,
    coins: tick.coins.filter(allowed).map((c) => strip(c, keep)),
  };
}
