import { z } from "zod";
import type { BiasState, TimeframeBiasDto } from "./flow.js";
import { signedFixed } from "./numbers.js";
import { type OrderflowWindow, REGIME_INFO, STRENGTH_LABEL } from "./orderflow.js";
import type { RatingDto, RatingTf } from "./ratings.js";
import type { ScalpCoinDto, ScalpEventDto } from "./scalp.js";
import type { Alignment } from "./scalp-alerts.js";
import type { CockpitZoneDto } from "./zones.js";

/**
 * Scalp Cockpit: everything the app knows about one market, read for a 5- or 15-minute trade on
 * one screen. Each reading is judged by a fixed rule written next to it and counted as leaning up,
 * down or neither. It is a count of readings, never a call: the decision, stop and size stay the
 * trader's.
 */

export const COCKPIT_TFS = ["5m", "15m"] as const;
export type CockpitTf = (typeof COCKPIT_TFS)[number];
/** The timeframes read for each choice: the chosen one, the next one up, and 1H. */
export const COCKPIT_FRAMES: Record<CockpitTf, readonly OrderflowWindow[]> = {
  "5m": ["5m", "15m", "1h"],
  "15m": ["15m", "30m", "1h"],
};

export const cockpitQuerySchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,20}USDT$/)
      .default("BTCUSDT"),
    tf: z.enum(COCKPIT_TFS).default("5m"),
  })
  .strict();
export type CockpitQuery = z.infer<typeof cockpitQuerySchema>;

export type Lean = "up" | "down" | "neutral";
export type ReadoutGroup = "flow" | "positioning" | "price" | "big_money" | "trend";
export const READOUT_GROUP_LABEL: Record<ReadoutGroup, string> = {
  flow: "Buying and selling",
  positioning: "Positioning",
  price: "Price location",
  big_money: "Big money",
  trend: "Trend",
};

export interface ReadoutRow {
  key: string;
  group: ReadoutGroup;
  label: string;
  value: string;
  lean: Lean;
  /** The fixed rule that decided the lean. */
  rule: string;
}

export interface CockpitFlag {
  key: string;
  level: "high" | "medium";
  text: string;
}

export interface CockpitLevel {
  label: string;
  price: number;
  /** Distance from price, % (positive = above). */
  distPct: number;
}

export interface ScalpRecordDto {
  /** Closed trades on this market held one hour or less, in the last 180 days, USD-settled. */
  trades: number;
  wins: number;
  winRate: number | null;
  netPnl: string;
  avgHoldMin: number | null;
  sessions: Array<{
    id: string;
    label: string;
    trades: number;
    winRate: number | null;
    netPnl: string;
  }>;
  /** True once there are enough trades for the numbers to mean something. */
  enough: boolean;
  /**
   * The same scalps split by the Cockpit count at entry on the chosen timeframe: with the
   * readings, against them, or split. Only trades from when readings were being recorded.
   */
  readings: {
    stamped: number;
    groups: Array<{
      key: Alignment;
      label: string;
      trades: number;
      winRate: number | null;
      netPnl: string;
    }>;
  };
}

export interface CockpitDto {
  symbol: string;
  name: string;
  tf: CockpitTf;
  /** Symbols the trader can open here (plan), most traded first. */
  symbols: string[];
  coin: ScalpCoinDto | null;
  computedAt: string | null;
  rows: ReadoutRow[];
  tally: { up: number; down: number; neutral: number };
  flags: CockpitFlag[];
  session: string;
  events: ScalpEventDto[];
  headlines: Array<{ title: string; publishedAt: string; why: string | null; url: string | null }>;
  /** Nearest levels above and below price (day, Asia, 24h, VWAP). */
  levelAbove: CockpitLevel | null;
  levelBelow: CockpitLevel | null;
  /** Biggest estimated liquidation pools within 3% (shorts above, longs below). */
  liqAbove: (CockpitLevel & { usd: number }) | null;
  liqBelow: (CockpitLevel & { usd: number }) | null;
  /** Nearest 1H and 4H supply zones above and demand zones below (two each per timeframe). */
  zones: CockpitZoneDto[];
  /** Whale orders and real liquidations over the chosen timeframe (Market Flow markets). */
  whales: { buyUsd: number; sellUsd: number; buys: number; sells: number } | null;
  liquidations: { longUsd: number; shortUsd: number } | null;
  bias: TimeframeBiasDto[];
  /** The readings' other inputs, so the page can recount them live: one-hour trend as counted,
   * and high-impact headlines (one per story) in the last 30 minutes. */
  bias1h: BiasState | null;
  hotHeadlines: number;
  /** Correlation with Bitcoin over 24 hours (coins other than BTC). */
  btcCorr24h: number | null;
  record: ScalpRecordDto | null;
  open: Array<{
    direction: "LONG" | "SHORT";
    entryPrice: string | null;
    unrealizedPnl: string | null;
    exchange: string;
  }>;
  /** Indicator gauges per timeframe (the 20 most traded coins, gold and silver). */
  ratings: Partial<Record<RatingTf, RatingDto>> | null;
  /** Parts the plan does not include. */
  locked: string[];
}

export const COCKPIT_DISCLAIMER =
  "Each reading is judged by the fixed rule shown next to it and counted. It is a count of what the market is doing, not a forecast or a signal: markets often move against most readings. The decision, the stop and the size are yours.";

// ─── Rules ───

export interface ReadoutInput {
  tf: CockpitTf;
  coin: ScalpCoinDto;
  now: number;
  computedAt: string | null;
  events: ScalpEventDto[];
  /** Headlines rated High in the last 30 minutes. */
  hotHeadlines: number;
  whales: CockpitDto["whales"];
  liquidations: CockpitDto["liquidations"];
  bias1h: BiasState | null;
}

const sign = (v: number, digits = 2) => signedFixed(v, digits);
const usd = (v: number) => {
  const a = Math.abs(v);
  const s =
    a >= 1e9
      ? `${(a / 1e9).toFixed(2)}B`
      : a >= 1e6
        ? `${(a / 1e6).toFixed(2)}M`
        : a >= 1e3
          ? `${(a / 1e3).toFixed(1)}K`
          : a.toFixed(0);
  return `${v < 0 && Number(s.replace(/[BMK]$/, "")) !== 0 ? "−" : ""}$${s}`;
};
const strengthLean = (s: string): Lean =>
  s === "buying" || s === "strong_buying"
    ? "up"
    : s === "selling" || s === "strong_selling"
      ? "down"
      : "neutral";

/** Thresholds of the counted readings (kept here so the page can show them). */
export const READOUT_RULES = {
  vwapPct: 0.05,
  bookImbalancePct: 20,
  whaleShare: 0.2,
  liqMultiple: 2,
  fundingHigh: 0.0003,
  fundingLow: -0.0001,
  spreadBps: 5,
  nearLevelAtr: 0.5,
} as const;

/** The counted readings, the warnings, and the tally for one market and timeframe. */
export function buildScalpReadout(input: ReadoutInput): {
  rows: ReadoutRow[];
  flags: CockpitFlag[];
  tally: CockpitDto["tally"];
} {
  const { coin, tf } = input;
  const R = READOUT_RULES;
  const rows: ReadoutRow[] = [];
  const flags: CockpitFlag[] = [];
  const label = (w: OrderflowWindow) => (w === "1h" ? "1H" : w);

  // Buying and selling: strength on the chosen timeframe, the next one up, and 1H.
  for (const w of COCKPIT_FRAMES[tf]) {
    const f = coin.frames[w];
    if (!f) continue;
    rows.push({
      key: `strength_${w}`,
      group: "flow",
      label: `Strength ${label(w)}`,
      value: `${STRENGTH_LABEL[f.strength]} (${sign(f.buyPressurePct, 1)}%)`,
      lean: strengthLean(f.strength),
      rule: "Buying or Strong buying counts up, Selling or Strong selling down.",
    });
  }

  // Positioning: what open interest did with price on the chosen timeframe.
  const ft = coin.frames[tf];
  if (ft) {
    const r = ft.regime;
    rows.push({
      key: "regime",
      group: "positioning",
      label: `Open interest ${tf}`,
      value: `${REGIME_INFO[r].label} (OI ${ft.oiChangePct === null ? "—" : `${sign(ft.oiChangePct)}%`})`,
      lean:
        r === "long_buildup" || r === "short_covering"
          ? "up"
          : r === "short_buildup" || r === "long_unwinding"
            ? "down"
            : "neutral",
      rule: "Long build-up or short covering counts up; short build-up or long unwinding down.",
    });
    if (ft.relVolume !== null && ft.relVolume >= 2.5)
      flags.push({
        key: "volume",
        level: "medium",
        text: `Volume on ${tf} is ${ft.relVolume.toFixed(1)}× its usual pace: something is happening.`,
      });
  }
  if (coin.funding !== null) {
    const f = coin.funding;
    rows.push({
      key: "funding",
      group: "positioning",
      label: "Funding",
      value: `${sign(f * 100, 4)}% per settlement`,
      lean: f > R.fundingHigh ? "down" : f < R.fundingLow ? "up" : "neutral",
      rule: "Above 0.03% longs are crowded (counts down); below −0.01% shorts are crowded (counts up).",
    });
    if (Math.abs(f) >= 0.0005)
      flags.push({
        key: "funding",
        level: "medium",
        text: "Funding is extreme: one side is crowded and squeezes can be violent.",
      });
  }

  // Price location.
  if (coin.vwapDistPct !== null) {
    const d = coin.vwapDistPct;
    rows.push({
      key: "vwap",
      group: "price",
      label: "Price vs VWAP",
      value: `${sign(d)}% ${d >= 0 ? "above" : "below"}`,
      lean: d >= R.vwapPct ? "up" : d <= -R.vwapPct ? "down" : "neutral",
      rule: `More than ${R.vwapPct}% above today's VWAP counts up, below counts down.`,
    });
  }
  const book = coin.book;
  const band = book?.bands.find((b) => b.pct === 0.25) ?? book?.bands.at(-1);
  if (book && band) {
    rows.push({
      key: "book",
      group: "price",
      label: `Order book ±${band.pct}%`,
      value: `${band.imbalancePct >= 0 ? "Bids" : "Asks"} heavier (${sign(band.imbalancePct, 0)}%)`,
      lean:
        band.imbalancePct >= R.bookImbalancePct
          ? "up"
          : band.imbalancePct <= -R.bookImbalancePct
            ? "down"
            : "neutral",
      rule: `Bids ${R.bookImbalancePct}% or more heavier than asks counts up, the reverse down. Orders can be pulled.`,
    });
    if (book.spreadBps > R.spreadBps)
      flags.push({
        key: "spread",
        level: "medium",
        text: `The spread is wide (${book.spreadBps.toFixed(1)} bps): entries and exits cost more than usual.`,
      });
  }

  // Big money over the chosen timeframe.
  if (input.whales) {
    const { buyUsd, sellUsd } = input.whales;
    const total = buyUsd + sellUsd;
    const share = total > 0 ? (buyUsd - sellUsd) / total : 0;
    rows.push({
      key: "whales",
      group: "big_money",
      label: `Whale orders ${tf}`,
      value:
        total > 0
          ? `${usd(buyUsd - sellUsd)} net (${usd(buyUsd)} bought, ${usd(sellUsd)} sold)`
          : "None",
      lean:
        total === 0
          ? "neutral"
          : share >= R.whaleShare
            ? "up"
            : share <= -R.whaleShare
              ? "down"
              : "neutral",
      rule: "Whale buys at least 20% more than sells (of their total) counts up, the reverse down.",
    });
  }
  if (input.liquidations) {
    const { longUsd, shortUsd } = input.liquidations;
    rows.push({
      key: "liquidations",
      group: "big_money",
      label: `Liquidations ${tf}`,
      value: longUsd + shortUsd > 0 ? `Longs ${usd(longUsd)}, shorts ${usd(shortUsd)}` : "None",
      lean:
        shortUsd > 0 && shortUsd >= R.liqMultiple * longUsd
          ? "up"
          : longUsd > 0 && longUsd >= R.liqMultiple * shortUsd
            ? "down"
            : "neutral",
      rule: "Shorts liquidated at least twice as much as longs (forced buying) counts up, the reverse down.",
    });
  }

  // Trend.
  if (input.bias1h) {
    rows.push({
      key: "bias_1h",
      group: "trend",
      label: "Trend 1H",
      value: input.bias1h === "up" ? "Up-trend" : input.bias1h === "down" ? "Down-trend" : "Range",
      lean: input.bias1h === "range" ? "neutral" : input.bias1h,
      rule: "Measured 1-hour trend (EMAs and swing structure) counts its way; a range is neutral.",
    });
  }

  // Warnings that are not counted.
  const minutes = (iso: string) => Math.round((Date.parse(iso) - input.now) / 60_000);
  for (const e of input.events) {
    const m = minutes(e.startsAt);
    if (m <= 30 && m >= -15)
      flags.push({
        key: `event_${e.title}`,
        level: "high",
        text:
          m > 0
            ? `${e.title} (${e.currency}) in ${m} min: spreads widen and price can jump several ranges in seconds.`
            : `${e.title} (${e.currency}) came out ${m === 0 ? "just now" : `${-m} min ago`}: the first minutes are the wildest.`,
      });
  }
  if (input.hotHeadlines > 0)
    flags.push({
      key: "headlines",
      level: "high",
      text: `${input.hotHeadlines} high-impact headline${input.hotHeadlines > 1 ? "s" : ""} in the last 30 minutes: check the news before entering.`,
    });
  if (coin.volatility.activity === "very_active")
    flags.push({
      key: "activity",
      level: "medium",
      text: "Very active: the last 30 minutes move twice the usual range or more, so stops get hit more easily.",
    });
  const atr5 = coin.volatility.atr5m;
  const L = coin.levels;
  if (atr5 && L) {
    const near = [
      ["today's high", L.dayHigh],
      ["today's low", L.dayLow],
      ["the Asia high", L.asiaHigh],
      ["the Asia low", L.asiaLow],
    ] as const;
    for (const [name, lvl] of near) {
      if (lvl !== null && Math.abs(coin.price - lvl) <= R.nearLevelAtr * atr5) {
        flags.push({
          key: `near_${name}`,
          level: "medium",
          text: `Price is at ${name} (within half a 5-minute range): breakouts and rejections are both common here.`,
        });
        break;
      }
    }
  }
  if (input.computedAt && input.now - Date.parse(input.computedAt) > 3 * 60_000)
    flags.push({
      key: "stale",
      level: "high",
      text: "These figures are more than 3 minutes old: the data feed is catching up.",
    });

  const tally = { up: 0, down: 0, neutral: 0 };
  for (const r of rows) tally[r.lean]++;
  return { rows, flags, tally };
}

/** The nearest levels above and below price. */
export function nearestLevels(coin: ScalpCoinDto): {
  above: CockpitLevel | null;
  below: CockpitLevel | null;
} {
  const L = coin.levels;
  const all: Array<[string, number | null]> = [
    ["24h high", L?.high24h ?? null],
    ["Today's high", L?.dayHigh ?? null],
    ["Asia high", L?.asiaHigh ?? null],
    ["Asia low", L?.asiaLow ?? null],
    ["Today's low", L?.dayLow ?? null],
    ["24h low", L?.low24h ?? null],
    ["VWAP", coin.vwap],
  ];
  const lv = all
    .filter((x): x is [string, number] => x[1] !== null && x[1] > 0)
    .map(([label, price]) => ({ label, price, distPct: (price / coin.price - 1) * 100 }));
  const above = lv.filter((l) => l.price > coin.price).sort((a, b) => a.price - b.price)[0] ?? null;
  const below = lv.filter((l) => l.price < coin.price).sort((a, b) => b.price - a.price)[0] ?? null;
  return { above, below };
}
