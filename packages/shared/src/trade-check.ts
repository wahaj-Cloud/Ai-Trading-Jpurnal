import { z } from "zod";
import {
  DESK_SYMBOLS,
  type DeskEventDto,
  type DeskSymbol,
  isMetal,
  type MarketDeskDto,
  untilLabel,
} from "./desk.js";
import type { TimeframeBiasDto } from "./flow.js";
import type { LiquidationClusterDto } from "./market.js";

/**
 * Trade Check: every reading a professional looks at before taking a position, for one market,
 * gathered on one page. Each reading says, from its own evidence and a fixed published rule, whether
 * it supports longs, supports shorts or is neutral. The page counts them; it never adds them up into
 * a call, because a count of factors is context, not a trade signal.
 */

export const CHECK_SYMBOLS = DESK_SYMBOLS;
export const contextKey = (s: DeskSymbol) => `context:${s}`;
export const MACRO_KEY = "macro";
export const STABLECOINS_KEY = "stablecoins";

// ─── What the worker saves ───

/** A Binance long/short ratio (accounts or positions). */
export interface LongShortReading {
  ratio: number;
  /** Share of accounts (or position size) that is long / short, 0..1. */
  longShare: number;
  shortShare: number;
  /** Ratio change against 24 hours earlier (fraction, 0.1 = +10%). */
  change24h: number | null;
  /** Where the ratio sits within its own last ~20 days of hourly readings, 0..100. */
  percentile: number | null;
  at: string;
}

export interface BasisReading {
  /** The quarterly futures contract compared with the index, e.g. BTCUSDT_261225. */
  contract: string;
  expiry: string;
  daysToExpiry: number;
  /** Quarterly mark price against the index price, %. */
  basisPct: number;
  /** The same premium as a yearly rate, %. */
  annualizedPct: number;
}

export interface OptionsReading {
  currency: "BTC" | "ETH";
  /** Deribit DVOL: the 30-day implied volatility index, in % a year. */
  dvol: number | null;
  /** DVOL change against 24 hours earlier, in volatility points. */
  dvolChange24h: number | null;
  /** Put open interest divided by call open interest, every expiry. */
  putCallOi: number;
  /** The expiry with the most open interest in the next 30 days. */
  expiry: string;
  expiryOiShare: number;
  /** The price at which that expiry's options pay their holders the least. */
  maxPain: number;
  /** 25-delta put implied volatility minus 25-delta call implied volatility, vol points. */
  skew25d: number | null;
  /** The expiry used for the skew (the first one at least 7 days away). */
  skewExpiry: string | null;
  underlying: number;
}

export interface KeyLevels {
  prevDayHigh: number;
  prevDayLow: number;
  prevWeekHigh: number | null;
  prevWeekLow: number | null;
  ema200d: number | null;
  ema50d: number | null;
}

/** Saved by the worker every 15 minutes per market (market_snapshots key context:<SYMBOL>). */
export interface MarketContextDto {
  symbol: DeskSymbol;
  computedAt: string;
  price: number | null;
  change24hPct: number | null;
  /** Funding rate for the next settlement (fraction). */
  fundingRate: number | null;
  /** Combined open interest change over 24h on Binance, Bybit and OKX, %. */
  oiChange24hPct: number | null;
  weeklyBias: TimeframeBiasDto | null;
  levels: KeyLevels | null;
  /** All Binance accounts with a position, and Binance's top 20% of traders by margin (size). */
  accounts: LongShortReading | null;
  topPositions: LongShortReading | null;
  /** Taker buy volume divided by taker sell volume (aggressive buyers vs sellers). */
  taker: { ratio4h: number; ratio24h: number } | null;
  basis: BasisReading | null;
  /** Coinbase USD price against Binance USDT price (adjusted by USDT's own price), %. */
  coinbasePremiumPct: number | null;
  options: OptionsReading | null;
}

export const FRED_SERIES = ["DTWEXBGS", "DGS10", "SP500", "NASDAQCOM", "VIXCLS"] as const;
export type FredSeriesId = (typeof FRED_SERIES)[number];
export const FRED_LABEL: Record<FredSeriesId, string> = {
  DTWEXBGS: "US dollar index (broad)",
  DGS10: "US 10-year yield",
  SP500: "S&P 500",
  NASDAQCOM: "Nasdaq Composite",
  VIXCLS: "VIX (stock-market fear)",
};

export interface MacroSeriesDto {
  id: FredSeriesId;
  label: string;
  /** Latest close (previous trading day's), with the date it belongs to. */
  value: number;
  date: string;
  /** Against the close about one week (5 trading days) earlier. */
  change: number | null;
  changePct: number | null;
}

export interface MacroDto {
  series: MacroSeriesDto[];
  updatedAt: string;
}

export interface StablecoinDto {
  totalUsd: number;
  change7dPct: number | null;
  change30dPct: number | null;
  date: string;
  updatedAt: string;
}

// ─── What the page shows ───

export type CheckLean = "long" | "short" | "neutral" | "info";
export const CHECK_GROUPS = ["trend", "mood", "positioning", "spot", "options", "macro"] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];
export const CHECK_GROUP_INFO: Record<CheckGroup, { label: string; about: string }> = {
  trend: {
    label: "Trend and levels",
    about: "Where price is against its trend on four timeframes and against last week's range.",
  },
  mood: { label: "Crowd mood", about: "How greedy or fearful the crypto market is." },
  positioning: {
    label: "Futures positioning",
    about: "Who is long, who is short, who is paying whom, and who is being forced out.",
  },
  spot: {
    label: "Spot and institutions",
    about: "US spot demand, the futures premium and the stablecoin money waiting on the side.",
  },
  options: {
    label: "Options",
    about: "What option traders pay for protection, and where this month's big expiry sits.",
  },
  macro: {
    label: "Macro",
    about: "The dollar, interest rates and the stock market, which move crypto and metals alike.",
  },
};

export interface CheckFactorDto {
  key: string;
  group: CheckGroup;
  label: string;
  /** The reading itself, formatted ("0.012% per settlement", "Up-trend, 14 candles"). */
  value: string;
  lean: CheckLean;
  /** Why it leans that way, in one plain sentence with the rule used. */
  why: string;
}

export type CheckFlagLevel = "high" | "medium";
export interface CheckFlagDto {
  key: string;
  level: CheckFlagLevel;
  text: string;
}

export interface TradeCheckDto {
  symbol: DeskSymbol;
  name: string;
  price: number | null;
  computedAt: string | null;
  /** Each counted factor once. "info" rows are not counted. */
  tally: { long: number; short: number; neutral: number };
  factors: CheckFactorDto[];
  flags: CheckFlagDto[];
  /** Plain-language description of the readings (a description, never a call). */
  reading: string[];
  levels: KeyLevels | null;
  /** Trend on the weekly, daily, 4-hour and 1-hour charts. */
  biases: TimeframeBiasDto[];
  nextEvent: DeskEventDto | null;
  /** Readings that could not be loaded right now. */
  missing: string[];
}

/** The trader's own closed trades on this market, grouped by the conditions at entry. */
export interface CheckRecordGroupDto {
  key: string;
  label: string;
  trades: number;
  winRate: number | null;
  netPnl: string;
  avgPnl: string | null;
  enough: boolean;
}

export interface CheckRecordDto {
  /** Closed USD-settled trades on this market in the last 365 days that could be matched. */
  total: number;
  groups: CheckRecordGroupDto[];
  /** Which group a new long or a new short would fall in, given the conditions now. */
  now: { long: string[]; short: string[] };
}

export const CHECK_MIN_GROUP = 10;

export type TradeCheckResponse =
  | { status: "ok"; check: TradeCheckDto; record: CheckRecordDto; allowed: DeskSymbol[] }
  | { status: "locked"; allowed: DeskSymbol[] }
  | { status: "unavailable"; reason: "pending"; allowed: DeskSymbol[] };

export const tradeCheckQuerySchema = z
  .object({ symbol: z.enum(CHECK_SYMBOLS).default("BTCUSDT") })
  .strict();
export type TradeCheckQuery = z.infer<typeof tradeCheckQuerySchema>;

export const CHECK_DISCLAIMER =
  "A checklist of market readings, each judged by a fixed rule shown next to it. It counts the readings; it does not tell you to buy or sell, and markets often move against most of them. Size every trade for being wrong.";

// ─── Rules ───

export interface TradeCheckInput {
  symbol: DeskSymbol;
  name: string;
  now: number;
  desk: Pick<MarketDeskDto, "price" | "computedAt" | "bias"> | null;
  context: MarketContextDto | null;
  fearGreed: { value: number; label: string } | null;
  btcDominance: number | null;
  altSeason: number | null;
  /** 24-hour whale taker orders and liquidations (Market Flow). */
  flow: {
    whaleBuyUsd: number;
    whaleSellUsd: number;
    whaleCount: number;
    longLiqUsd: number;
    shortLiqUsd: number;
  } | null;
  liqClusters: LiquidationClusterDto[] | null;
  macro: MacroDto | null;
  stablecoins: StablecoinDto | null;
  nextEvent: DeskEventDto | null;
  /** High-impact releases of the last 24 hours (to flag one that has just come out). */
  recentEvents?: DeskEventDto[];
}

/** Readings older than this are left out instead of being shown as current. */
export const CHECK_STALE_MS = {
  context: 45 * 60_000,
  desk: 45 * 60_000,
  macro: 4 * 86_400_000,
  stablecoins: 3 * 86_400_000,
} as const;

const H = 3_600_000;

export const fmtPrice = (v: number) =>
  v.toLocaleString("en-US", {
    maximumFractionDigits: v >= 1000 ? 0 : v >= 10 ? 2 : v >= 1 ? 3 : 5,
  });
const pct = (v: number, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const usd = (v: number) =>
  `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;
const TF_NAME = { "1w": "Weekly", "1d": "Daily", "4h": "4-hour", "1h": "1-hour" } as const;
const BIAS_WORD = { up: "Up-trend", down: "Down-trend", range: "Range" } as const;

/** Lean from a value and two thresholds (at or beyond the threshold counts). */
function band(v: number, longAt: (v: number) => boolean, shortAt: (v: number) => boolean) {
  return longAt(v) ? "long" : shortAt(v) ? "short" : "neutral";
}

/**
 * Every factor with its lean, the risk flags and a plain description. Pure and deterministic: the
 * same readings always give the same page, so every rule can be tested and audited.
 */
export function buildTradeCheck(input: TradeCheckInput): TradeCheckDto {
  const { now, symbol } = input;
  const metal = isMetal(symbol);
  const factors: CheckFactorDto[] = [];
  const flags: CheckFlagDto[] = [];
  const missing: string[] = [];
  const add = (f: CheckFactorDto) => factors.push(f);

  const fresh = (iso: string | null | undefined, maxAge: number) =>
    !!iso && now - Date.parse(iso) <= maxAge;
  const ctx =
    input.context && fresh(input.context.computedAt, CHECK_STALE_MS.context) ? input.context : null;
  if (!ctx) missing.push("Futures positioning, spot and options readings (updating)");
  const desk = input.desk && fresh(input.desk.computedAt, CHECK_STALE_MS.desk) ? input.desk : null;
  const price = ctx?.price ?? desk?.price ?? null;

  // ── Trend and levels ──
  const biases: TimeframeBiasDto[] = [
    ...(ctx?.weeklyBias ? [ctx.weeklyBias] : []),
    ...(desk?.bias ?? []),
  ];
  for (const b of biases) {
    add({
      key: `bias_${b.timeframe}`,
      group: "trend",
      label: `${TF_NAME[b.timeframe]} trend`,
      value: `${BIAS_WORD[b.state]}, ${b.bars}${b.bars >= 99 ? "+" : ""} candle${b.bars === 1 ? "" : "s"}`,
      lean: b.state === "up" ? "long" : b.state === "down" ? "short" : "neutral",
      why:
        b.state === "range"
          ? "Price, the 50/200 EMAs and swing structure do not agree, so no trend is counted."
          : `Two or more of price vs 50 EMA, 50 vs 200 EMA and swing structure point ${b.state}.`,
    });
  }
  if (biases.length === 0) missing.push("Trend (updating)");
  const tf = (t: string) => biases.find((b) => b.timeframe === t)?.state;
  const d1 = tf("1d");
  const h4 = tf("4h");
  if (d1 && h4 && d1 !== "range" && h4 !== "range" && d1 !== h4)
    flags.push({
      key: "trend_conflict",
      level: "medium",
      text: `The daily trend is ${d1} but the 4-hour trend is ${h4}: trades against the bigger trend fail more often.`,
    });

  const lv = ctx?.levels ?? null;
  if (lv && price !== null && lv.ema200d !== null) {
    const dist = (price / lv.ema200d - 1) * 100;
    add({
      key: "ema200d",
      group: "trend",
      label: "Price vs 200-day EMA",
      value: `${pct(dist)} (EMA ${fmtPrice(lv.ema200d)})`,
      lean: band(
        dist,
        (v) => v >= 0.5,
        (v) => v <= -0.5,
      ),
      why: "Above the 200-day average is a long-term up market, below it a down market (within ±0.5% counts as neutral).",
    });
  }
  if (lv && price !== null && lv.prevWeekHigh !== null && lv.prevWeekLow !== null) {
    const hi = lv.prevWeekHigh;
    const lo = lv.prevWeekLow;
    const pos = hi > lo ? (price - lo) / (hi - lo) : 0.5;
    let lean: CheckLean = "neutral";
    let why = "Inside the middle of last week's range: no edge from location.";
    let value = `${Math.round(pos * 100)}% of last week's range`;
    if (price > hi) {
      lean = "long";
      value = `Above last week's high (${fmtPrice(hi)})`;
      why = "Price broke above last week's high: buyers are in control of the weekly range.";
    } else if (price < lo) {
      lean = "short";
      value = `Below last week's low (${fmtPrice(lo)})`;
      why = "Price broke below last week's low: sellers are in control of the weekly range.";
    } else if (pos >= 0.8) {
      lean = "short";
      why = "In the top fifth of last week's range (premium): longs here buy near resistance.";
    } else if (pos <= 0.2) {
      lean = "long";
      why = "In the bottom fifth of last week's range (discount): shorts here sell near support.";
    }
    add({ key: "week_range", group: "trend", label: "Location in weekly range", value, lean, why });
  }
  if (lv && price !== null) {
    add({
      key: "day_range",
      group: "trend",
      label: "Yesterday's high / low",
      value: `${fmtPrice(lv.prevDayHigh)} / ${fmtPrice(lv.prevDayLow)}`,
      lean: "info",
      why:
        price > lv.prevDayHigh
          ? "Price is above yesterday's high."
          : price < lv.prevDayLow
            ? "Price is below yesterday's low."
            : "Price is inside yesterday's range; its edges are the nearest reference levels.",
    });
  }

  // ── Crowd mood (crypto only) ──
  if (!metal) {
    const fg = input.fearGreed;
    if (fg) {
      add({
        key: "fear_greed",
        group: "mood",
        label: "Fear & Greed Index",
        value: `${fg.value} · ${fg.label}`,
        lean: band(
          fg.value,
          (v) => v <= 25,
          (v) => v >= 75,
        ),
        why:
          fg.value <= 25
            ? "Extreme fear: the crowd has mostly sold already, which has often been near lows."
            : fg.value >= 75
              ? "Extreme greed: the crowd is already in, which has often been near highs."
              : "Between 26 and 74: mood is not at an extreme, so it is not counted either way.",
      });
    } else missing.push("Fear & Greed Index");
    if (input.btcDominance !== null)
      add({
        key: "btc_dominance",
        group: "mood",
        label: "Bitcoin dominance",
        value: `${input.btcDominance.toFixed(1)}%`,
        lean: "info",
        why: "Bitcoin's share of the whole crypto market. Rising dominance usually means money is leaving altcoins.",
      });
    if (input.altSeason !== null)
      add({
        key: "alt_season",
        group: "mood",
        label: "Altcoin Season Index",
        value: `${input.altSeason} / 100`,
        lean: "info",
        why:
          input.altSeason >= 75
            ? "Altcoin season: most top coins beat Bitcoin over 90 days."
            : input.altSeason <= 25
              ? "Bitcoin season: most top coins lagged Bitcoin over 90 days."
              : "Neither Bitcoin nor altcoin season.",
      });
  }

  // ── Futures positioning ──
  if (ctx?.fundingRate !== null && ctx?.fundingRate !== undefined) {
    const r = ctx.fundingRate;
    add({
      key: "funding",
      group: "positioning",
      label: "Funding rate",
      value: `${pct(r * 100, 4)} per settlement`,
      lean: band(
        r,
        (v) => v < -0.0001,
        (v) => v > 0.0003,
      ),
      why:
        r > 0.0003
          ? "Longs are paying well above the normal 0.01%: the long side is crowded and pays to stay in."
          : r < -0.0001
            ? "Shorts are paying longs: the short side is crowded, which can fuel a squeeze up."
            : "Close to the normal 0.01%: neither side is paying heavily.",
    });
    if (Math.abs(r) >= 0.0005)
      flags.push({
        key: "funding_extreme",
        level: "medium",
        text: `Funding is ${pct(r * 100, 3)} per settlement: one side is crowded and squeezes can be violent.`,
      });
  }
  if (
    ctx?.oiChange24hPct !== null &&
    ctx?.oiChange24hPct !== undefined &&
    ctx.change24hPct !== null
  ) {
    const oi = ctx.oiChange24hPct;
    const ch = ctx.change24hPct;
    let lean: CheckLean = "neutral";
    let why = "Open interest barely changed: the move is not backed by new positions.";
    if (oi >= 3 && ch >= 1) {
      lean = "long";
      why = "Price rose while new positions opened: fresh money is behind the rise.";
    } else if (oi >= 3 && ch <= -1) {
      lean = "short";
      why = "Price fell while new positions opened: fresh shorts are pressing the move.";
    } else if (oi <= -3) {
      why = "Positions are being closed: the move is unwinding rather than new conviction.";
    } else if (oi >= 3) {
      why = "New positions opened but price went nowhere: a breakout either way can follow.";
    }
    add({
      key: "oi_price",
      group: "positioning",
      label: "Open interest vs price (24h)",
      value: `OI ${pct(oi, 1)} · price ${pct(ch, 1)}`,
      lean,
      why,
    });
  }
  if (ctx?.accounts) {
    const a = ctx.accounts;
    const p = a.percentile;
    add({
      key: "ls_accounts",
      group: "positioning",
      label: "Long/short ratio, all accounts",
      value: `${a.ratio.toFixed(2)} (${Math.round(a.longShare * 100)}% long)${p !== null ? ` · ${Math.round(p)}th pct of 20 days` : ""}`,
      lean:
        p === null
          ? "neutral"
          : band(
              p,
              (v) => v <= 20,
              (v) => v >= 80,
            ),
      why:
        p === null
          ? "Not enough history yet to compare."
          : p >= 80
            ? "More accounts are long than on most days of the last 20: the crowd is leaning long, which tends to mark tops."
            : p <= 20
              ? "Fewer accounts are long than on most days of the last 20: the crowd is leaning short, which tends to mark lows."
              : "Within its normal 20-day range.",
    });
  }
  if (ctx?.topPositions) {
    const t = ctx.topPositions;
    const p = t.percentile;
    add({
      key: "ls_top",
      group: "positioning",
      label: "Top traders' long/short (size)",
      value: `${t.ratio.toFixed(2)} (${Math.round(t.longShare * 100)}% long)${p !== null ? ` · ${Math.round(p)}th pct` : ""}`,
      lean:
        p === null
          ? "neutral"
          : band(
              p,
              (v) => v >= 80,
              (v) => v <= 20,
            ),
      why:
        p === null
          ? "Not enough history yet to compare."
          : p >= 80
            ? "Binance's biggest traders hold more long size than on most days of the last 20."
            : p <= 20
              ? "Binance's biggest traders hold more short size than on most days of the last 20."
              : "Big traders' positioning is within its normal 20-day range.",
    });
  }
  if (ctx?.taker) {
    const t = ctx.taker;
    add({
      key: "taker",
      group: "positioning",
      label: "Taker buy/sell (4h)",
      value: `${t.ratio4h.toFixed(2)} (24h ${t.ratio24h.toFixed(2)})`,
      lean: band(
        t.ratio4h,
        (v) => v >= 1.1,
        (v) => v <= 0.9,
      ),
      why:
        t.ratio4h >= 1.1
          ? "Aggressive buyers took at least 10% more than aggressive sellers in the last 4 hours."
          : t.ratio4h <= 0.9
            ? "Aggressive sellers took at least 10% more than aggressive buyers in the last 4 hours."
            : "Market buying and selling were within 10% of each other.",
    });
  }
  const fl = input.flow;
  if (fl) {
    const total = fl.whaleBuyUsd + fl.whaleSellUsd;
    const share = total > 0 ? (fl.whaleBuyUsd - fl.whaleSellUsd) / total : 0;
    add({
      key: "whales",
      group: "positioning",
      label: "Whale orders (24h)",
      value:
        total > 0
          ? `${usd(fl.whaleBuyUsd)} bought · ${usd(fl.whaleSellUsd)} sold`
          : "No whale orders",
      lean:
        fl.whaleCount < 5
          ? "neutral"
          : band(
              share,
              (v) => v >= 0.2,
              (v) => v <= -0.2,
            ),
      why:
        fl.whaleCount < 5
          ? "Fewer than 5 whale orders: too few to read."
          : share >= 0.2
            ? "Large market orders bought at least 20% more than they sold."
            : share <= -0.2
              ? "Large market orders sold at least 20% more than they bought."
              : "Large buyers and sellers roughly matched.",
    });
    add({
      key: "liquidations",
      group: "positioning",
      label: "Liquidations (24h)",
      value: `Longs ${usd(fl.longLiqUsd)} · shorts ${usd(fl.shortLiqUsd)}`,
      lean: "info",
      why:
        fl.longLiqUsd > 2 * fl.shortLiqUsd && fl.longLiqUsd > 0
          ? "Mostly longs were forced out: some leverage has already been flushed below."
          : fl.shortLiqUsd > 2 * fl.longLiqUsd && fl.shortLiqUsd > 0
            ? "Mostly shorts were forced out: some leverage has already been flushed above."
            : "Forced closes were balanced between longs and shorts.",
    });
  }
  if (input.liqClusters && price !== null) {
    const near = input.liqClusters.filter((c) => Math.abs(c.price / price - 1) <= 0.08);
    const above = near
      .filter((c) => c.side === "short" && c.price > price)
      .reduce((s, c) => s + c.usd, 0);
    const below = near
      .filter((c) => c.side === "long" && c.price < price)
      .reduce((s, c) => s + c.usd, 0);
    if (above + below > 0) {
      const ratio = below > 0 ? above / below : Number.POSITIVE_INFINITY;
      add({
        key: "liq_pools",
        group: "positioning",
        label: "Liquidation pools within 8%",
        value: `${usd(above)} above · ${usd(below)} below`,
        lean: band(
          ratio,
          (v) => v >= 1.5,
          (v) => v <= 1 / 1.5,
        ),
        why:
          ratio >= 1.5
            ? "Much more estimated short liquidation above than long liquidation below: price is often drawn toward the bigger pool."
            : ratio <= 1 / 1.5
              ? "Much more estimated long liquidation below than short liquidation above: price is often drawn toward the bigger pool."
              : "The pools above and below are of similar size.",
      });
    }
  }

  // ── Spot and institutions ──
  if (ctx?.coinbasePremiumPct !== null && ctx?.coinbasePremiumPct !== undefined) {
    const p = ctx.coinbasePremiumPct;
    add({
      key: "coinbase_premium",
      group: "spot",
      label: "Coinbase premium",
      value: pct(p, 3),
      lean: band(
        p,
        (v) => v >= 0.05,
        (v) => v <= -0.05,
      ),
      why:
        p >= 0.05
          ? "US buyers on Coinbase pay more than Binance: American (often institutional) spot demand is strong."
          : p <= -0.05
            ? "Coinbase trades below Binance: US spot investors are selling or absent."
            : "Coinbase and Binance prices match within 0.05%.",
    });
  }
  if (ctx?.basis) {
    const b = ctx.basis;
    add({
      key: "basis",
      group: "spot",
      label: "Futures basis (quarterly)",
      value: `${pct(b.annualizedPct, 1)} a year (${b.daysToExpiry.toFixed(0)} days left)`,
      lean: b.annualizedPct >= 20 ? "short" : "neutral",
      why:
        b.annualizedPct >= 20
          ? "Futures trade far above spot: leveraged longs are paying a high premium, typical of overheated markets."
          : b.annualizedPct < 0
            ? "Futures trade below spot (backwardation): a sign of stress or heavy hedging."
            : "A normal futures premium (0–20% a year).",
    });
    if (b.annualizedPct < 0)
      flags.push({
        key: "backwardation",
        level: "medium",
        text: "Quarterly futures trade below spot: markets under stress tend to swing harder.",
      });
  }
  if (!metal) {
    const sc = input.stablecoins;
    if (sc && fresh(sc.updatedAt, CHECK_STALE_MS.stablecoins) && sc.change7dPct !== null) {
      add({
        key: "stablecoins",
        group: "spot",
        label: "Stablecoin supply (7 days)",
        value: `${usd(sc.totalUsd)} · ${pct(sc.change7dPct)}${sc.change30dPct !== null ? ` (30d ${pct(sc.change30dPct, 1)})` : ""}`,
        lean: band(
          sc.change7dPct,
          (v) => v >= 0.3,
          (v) => v <= -0.3,
        ),
        why:
          sc.change7dPct >= 0.3
            ? "New stablecoins are being issued: fresh cash is arriving that can buy crypto."
            : sc.change7dPct <= -0.3
              ? "Stablecoins are being redeemed: cash is leaving crypto."
              : "Stablecoin supply is roughly flat.",
      });
    } else missing.push("Stablecoin supply");
  }

  // ── Options (BTC and ETH) ──
  const op = ctx?.options ?? null;
  if (op) {
    if (op.skew25d !== null)
      add({
        key: "skew",
        group: "options",
        label: "25-delta skew",
        value: `${op.skew25d > 0 ? "+" : ""}${op.skew25d.toFixed(1)} vol pts`,
        lean: band(
          op.skew25d,
          (v) => v <= -2,
          (v) => v >= 4,
        ),
        why:
          op.skew25d >= 4
            ? "Puts cost clearly more than calls: option traders are paying up for downside protection."
            : op.skew25d <= -2
              ? "Calls cost more than puts: option traders are paying up for upside."
              : "Puts and calls are priced about evenly.",
      });
    add({
      key: "put_call",
      group: "options",
      label: "Put/call open interest",
      value: op.putCallOi.toFixed(2),
      lean: "info",
      why:
        op.putCallOi >= 1
          ? "More puts than calls are open: plenty of hedging is in place."
          : "More calls than puts are open, as is usual for crypto.",
    });
    if (op.dvol !== null)
      add({
        key: "dvol",
        group: "options",
        label: "Implied volatility (DVOL)",
        value: `${op.dvol.toFixed(1)}${op.dvolChange24h !== null ? ` (${op.dvolChange24h >= 0 ? "+" : "−"}${Math.abs(op.dvolChange24h).toFixed(1)} in 24h)` : ""}`,
        lean: "info",
        why: `Options price a typical daily move of about ${(op.dvol / Math.sqrt(365)).toFixed(1)}%.`,
      });
    if (op.dvol !== null && op.dvolChange24h !== null && op.dvolChange24h >= 0.15 * op.dvol)
      flags.push({
        key: "vol_jump",
        level: "medium",
        text: "Implied volatility jumped over 15% in a day: option traders expect a big move.",
      });
    const hoursLeft = (Date.parse(op.expiry) - now) / H;
    const dist = price !== null ? (price / op.maxPain - 1) * 100 : 0;
    const close = hoursLeft > 0 && hoursLeft <= 72;
    add({
      key: "max_pain",
      group: "options",
      label: "Max pain",
      value: `${fmtPrice(op.maxPain)} · expiry ${op.expiry.slice(0, 10)} (${Math.round(op.expiryOiShare * 100)}% of OI)`,
      lean: close && Math.abs(dist) >= 2 ? (dist > 0 ? "short" : "long") : "neutral",
      why: close
        ? Math.abs(dist) >= 2
          ? `Expiry is within 3 days and price is ${pct(dist, 1)} from max pain; into big expiries price is often pulled toward it.`
          : "Expiry is within 3 days and price is already near max pain."
        : "Only counted in the 3 days before expiry, when its pull is strongest.",
    });
    if (hoursLeft > 0 && hoursLeft <= 24 && op.expiryOiShare >= 0.2)
      flags.push({
        key: "expiry",
        level: "medium",
        text: `A large options expiry (${Math.round(op.expiryOiShare * 100)}% of open interest) settles ${untilLabel(hoursLeft * H)} at 08:00 UTC.`,
      });
  }

  // ── Macro ──
  const macro =
    input.macro && fresh(input.macro.updatedAt, CHECK_STALE_MS.macro) ? input.macro : null;
  const ser = (id: string) => macro?.series.find((s) => s.id === id);
  const asOf = (s: MacroSeriesDto) => `close of ${s.date}`;
  const dxy = ser("DTWEXBGS");
  if (dxy && dxy.changePct !== null)
    add({
      key: "dxy",
      group: "macro",
      label: "US dollar (1 week)",
      value: `${dxy.value.toFixed(2)} · ${pct(dxy.changePct)}`,
      lean: band(
        dxy.changePct,
        (v) => v <= -0.5,
        (v) => v >= 0.5,
      ),
      why: `${dxy.changePct >= 0.5 ? "A stronger dollar" : dxy.changePct <= -0.5 ? "A weaker dollar" : "A flat dollar"} (${asOf(dxy)}). ${metal ? "Gold and silver" : "Crypto"} usually move opposite the dollar; ±0.5% a week counts.`,
    });
  const y10 = ser("DGS10");
  if (y10 && y10.change !== null)
    add({
      key: "us10y",
      group: "macro",
      label: "US 10-year yield (1 week)",
      value: `${y10.value.toFixed(2)}% · ${y10.change >= 0 ? "+" : "−"}${Math.abs(y10.change).toFixed(2)} pts`,
      lean: band(
        y10.change,
        (v) => v <= -0.15,
        (v) => v >= 0.15,
      ),
      why: `${y10.change >= 0.15 ? "Rising" : y10.change <= -0.15 ? "Falling" : "Steady"} yields (${asOf(y10)}). Higher yields make holding ${metal ? "metals" : "crypto"} less attractive; ±0.15 points a week counts.`,
    });
  const ndx = ser("NASDAQCOM");
  if (ndx && ndx.changePct !== null)
    add({
      key: "nasdaq",
      group: "macro",
      label: "Nasdaq (1 week)",
      value: `${pct(ndx.changePct)}`,
      lean: metal
        ? "info"
        : band(
            ndx.changePct,
            (v) => v >= 1.5,
            (v) => v <= -1.5,
          ),
      why: metal
        ? `Tech stocks (${asOf(ndx)}); gold does not reliably follow them.`
        : `Crypto has tended to move with tech stocks (${asOf(ndx)}); ±1.5% a week counts.`,
    });
  const spx = ser("SP500");
  if (spx && spx.changePct !== null)
    add({
      key: "sp500",
      group: "macro",
      label: "S&P 500 (1 week)",
      value: `${fmtPrice(spx.value)} · ${pct(spx.changePct)}`,
      lean: "info",
      why: `Broad US stock market (${asOf(spx)}).`,
    });
  const vix = ser("VIXCLS");
  if (vix) {
    add({
      key: "vix",
      group: "macro",
      label: "VIX",
      value: `${vix.value.toFixed(1)}${vix.change !== null ? ` (${vix.change >= 0 ? "+" : "−"}${Math.abs(vix.change).toFixed(1)} in a week)` : ""}`,
      lean: metal ? "info" : vix.value >= 25 ? "short" : "neutral",
      why: metal
        ? `Stock-market fear gauge (${asOf(vix)}); fear can send money into gold.`
        : vix.value >= 25
          ? `Stock-market fear is high (${asOf(vix)}): risky assets like crypto are usually sold in risk-off weeks.`
          : `Stock-market fear is not elevated (${asOf(vix)}; 25+ counts).`,
    });
    if (vix.value >= 30)
      flags.push({
        key: "vix",
        level: "medium",
        text: `VIX is ${vix.value.toFixed(0)}: markets are in risk-off mode and moves are larger than usual.`,
      });
  }
  if (!macro) missing.push("Macro: dollar, yields, stocks (needs the free FRED key)");

  // ── Event risk ──
  const ev = input.nextEvent;
  if (ev) {
    const ms = Date.parse(ev.startsAt) - now;
    if (ms > 0 && ms <= 6 * H)
      flags.unshift({
        key: "event",
        level: ms <= 2 * H ? "high" : "medium",
        text: `${ev.currency} ${ev.title} is ${untilLabel(ms)}: spreads widen and price can whipsaw both ways.`,
      });
  }

  const just = (input.recentEvents ?? [])
    .map((e) => ({ e, ago: now - Date.parse(e.startsAt) }))
    .filter((x) => x.ago >= 0 && x.ago <= H)
    .sort((a, b) => a.ago - b.ago)[0];
  if (just) {
    const mins = Math.max(1, Math.round(just.ago / 60_000));
    const figures = just.e.actual
      ? ` (actual ${just.e.actual}${just.e.forecast ? ` vs forecast ${just.e.forecast}` : ""})`
      : "";
    flags.unshift({
      key: "released",
      level: "medium",
      text: `${just.e.currency} ${just.e.title} came out ${mins} min ago${figures}: price can keep swinging for a while after a release.`,
    });
  }

  const counted = factors.filter((f) => f.lean !== "info");
  const tally = {
    long: counted.filter((f) => f.lean === "long").length,
    short: counted.filter((f) => f.lean === "short").length,
    neutral: counted.filter((f) => f.lean === "neutral").length,
  };
  return {
    symbol,
    name: input.name,
    price,
    computedAt: ctx?.computedAt ?? desk?.computedAt ?? null,
    tally,
    factors,
    flags,
    reading: describe(tally, biases, factors, flags),
    levels: lv,
    biases,
    nextEvent: ev,
    missing,
  };
}

/** Plain sentences that describe the readings. They never say what to do. */
function describe(
  tally: TradeCheckDto["tally"],
  biases: TimeframeBiasDto[],
  factors: CheckFactorDto[],
  flags: CheckFlagDto[],
): string[] {
  const out: string[] = [];
  const total = tally.long + tally.short + tally.neutral;
  if (total === 0) return ["The readings are still loading."];
  const side =
    tally.long > tally.short
      ? `More readings support longs (${tally.long}) than shorts (${tally.short})`
      : tally.short > tally.long
        ? `More readings support shorts (${tally.short}) than longs (${tally.long})`
        : `Readings are evenly split (${tally.long} each way)`;
  out.push(`${side}; ${tally.neutral} of ${total} are neutral.`);
  const d1 = biases.find((b) => b.timeframe === "1d")?.state;
  const h4 = biases.find((b) => b.timeframe === "4h")?.state;
  if (d1 && h4)
    out.push(
      d1 === h4
        ? d1 === "range"
          ? "Both the daily and 4-hour charts are ranging."
          : `The daily and 4-hour trends agree: both ${d1}.`
        : `The daily chart is ${d1 === "range" ? "ranging" : d1} and the 4-hour chart ${h4 === "range" ? "is ranging" : h4}.`,
    );
  const loc = factors.find((f) => f.key === "week_range");
  if (loc) out.push(`Location: ${loc.value.charAt(0).toLowerCase()}${loc.value.slice(1)}.`);
  const crowd = factors.filter(
    (f) => ["funding", "ls_accounts"].includes(f.key) && f.lean !== "neutral",
  );
  if (crowd.length > 0)
    out.push(
      `Crowding: ${crowd.map((f) => `${f.label.toLowerCase()} ${f.lean === "short" ? "shows longs crowded" : "shows shorts crowded"}`).join("; ")}.`,
    );
  const high = flags.filter((f) => f.level === "high");
  if (high.length > 0) out.push(`Caution: ${high.map((f) => f.text).join(" ")}`);
  return out;
}
