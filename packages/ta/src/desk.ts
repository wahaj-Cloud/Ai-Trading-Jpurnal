import {
  DESK_NAMES,
  type DeskDriverDto,
  type DeskEventDto,
  type DeskLean,
  type DeskSymbol,
  isMetal,
  type MarketDeskDto,
  marketReaction,
  tallyLeans,
} from "@atc/shared";
import { type Candle, ema, rsi } from "./indicators.js";
import { marketStructure } from "./structure.js";

/**
 * Market Context Desk drivers. Each driver is a small, fixed rule over public data, so the result
 * is reproducible and every lean comes with the numbers behind it. The desk never combines the
 * drivers into a call: it only reports how many lean each way.
 */

export interface DeskCandle extends Candle {
  /** Share of volume bought by takers, 0..1 (null when unknown). */
  takerBuyShare: number | null;
}

export interface DeskInput {
  symbol: DeskSymbol;
  now: number;
  /** Closed 1h candles, oldest first (about 1,000 gives a full 200-period 4h average). */
  candles1h: readonly DeskCandle[];
  /** Funding rate for the next settlement as a fraction (0.0001 = 0.01%), null when unknown. */
  fundingRate: number | null;
  /** Price and rolling 24h change (%) right now, from the exchange's ticker. Falls back to candles. */
  live?: { price: number; change24hPct: number } | null;
  /** Open interest change over 24h in %, null when unknown. */
  oiChange24hPct: number | null;
  /** Estimated liquidation clusters (from the liquidation map), null when no map. */
  liqClusters: Array<{ side: "long" | "short"; price: number; usd: number }> | null;
  /** High-impact US (or global) releases in the last 24h and the next one coming. */
  recentEvents: DeskEventDto[];
  nextEvent: DeskEventDto | null;
  /** CoinMarketCap readings (crypto markets only). */
  fearGreed: number | null;
  btcDominance: number | null;
}

const fmtPct = (v: number, dp = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}%`;
const leanOf = (score: number, threshold = 1): DeskLean =>
  score >= threshold ? "up" : score <= -threshold ? "down" : "neutral";
const compactUsd = (v: number) =>
  `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;

/** Four 1h candles → one 4h candle, aligned to UTC 4-hour boundaries (as exchanges do). */
export function toFourHour(c1h: readonly DeskCandle[]): DeskCandle[] {
  const out: DeskCandle[] = [];
  const H4 = 4 * 3_600_000;
  for (const c of c1h) {
    const t = Math.floor(c.t / H4) * H4;
    const last = out.at(-1);
    if (last && last.t === t) {
      const buy = (last.takerBuyShare ?? 0.5) * last.v + (c.takerBuyShare ?? 0.5) * c.v;
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
      last.takerBuyShare = last.v > 0 ? buy / last.v : null;
    } else {
      out.push({ ...c, t });
    }
  }
  return out;
}

const lastOf = (xs: readonly (number | null)[]) => {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] !== null) return xs[i] as number;
  return null;
};

export function trendDriver(c1h: readonly DeskCandle[]): DeskDriverDto | null {
  const c4h = toFourHour(c1h);
  if (c4h.length < 60) return null;
  const closes = c4h.map((c) => c.c);
  const price = closes.at(-1) as number;
  const e20 = lastOf(ema(closes, 20));
  const e50 = lastOf(ema(closes, 50));
  const e200 = lastOf(ema(closes, 200));
  const s4 = marketStructure(c4h).trend;
  const s1 = marketStructure(c1h).trend;
  let score = 0;
  const evidence: string[] = [];
  if (e50 !== null) {
    score += price > e50 ? 1 : -1;
    evidence.push(
      `Price ${price > e50 ? "above" : "below"} the 4h 50 EMA (${fmtPct((price / e50 - 1) * 100)}).`,
    );
  }
  if (e200 !== null) {
    score += price > e200 ? 1 : -1;
    evidence.push(
      `Price ${price > e200 ? "above" : "below"} the 4h 200 EMA (${fmtPct((price / e200 - 1) * 100)}).`,
    );
  }
  if (e20 !== null && e50 !== null) {
    score += e20 > e50 ? 1 : -1;
    evidence.push(`4h 20 EMA ${e20 > e50 ? "above" : "below"} the 50 EMA.`);
  }
  const word = { UP: "higher highs and lows", DOWN: "lower highs and lows", RANGE: "ranging" };
  score += s4 === "UP" ? 1 : s4 === "DOWN" ? -1 : 0;
  score += s1 === "UP" ? 0.5 : s1 === "DOWN" ? -0.5 : 0;
  evidence.push(`Swing structure: 4h ${word[s4]}, 1h ${word[s1]}.`);
  const lean = leanOf(score, 2);
  return {
    key: "trend",
    lean,
    headline:
      lean === "up"
        ? "Price is above its key averages with rising structure."
        : lean === "down"
          ? "Price is below its key averages with falling structure."
          : "The averages and the structure disagree: no clear trend.",
    evidence,
  };
}

/** 24h change in %: the exchange's rolling figure when known, else from the last closed candles. */
function dayChange(c1h: readonly DeskCandle[], live?: DeskInput["live"]): number | null {
  if (live) return live.change24hPct;
  const last = c1h.at(-1);
  const dayAgo = c1h.at(-25)?.c ?? null;
  return last && dayAgo ? (last.c / dayAgo - 1) * 100 : null;
}

export function momentumDriver(
  c1h: readonly DeskCandle[],
  live?: DeskInput["live"],
): DeskDriverDto | null {
  if (c1h.length < 30) return null;
  const c4h = toFourHour(c1h);
  const r1 = lastOf(rsi(c1h.map((c) => c.c)));
  const r4 = lastOf(rsi(c4h.map((c) => c.c)));
  const change = dayChange(c1h, live);
  let score = 0;
  const evidence: string[] = [];
  if (r4 !== null) {
    score += r4 > 55 ? 1 : r4 < 45 ? -1 : 0;
    evidence.push(
      `RSI 4h ${r4.toFixed(0)}${r4 >= 70 ? " (stretched high)" : r4 <= 30 ? " (stretched low)" : ""}.`,
    );
  }
  if (r1 !== null) {
    score += r1 > 55 ? 0.5 : r1 < 45 ? -0.5 : 0;
    evidence.push(
      `RSI 1h ${r1.toFixed(0)}${r1 >= 70 ? " (stretched high)" : r1 <= 30 ? " (stretched low)" : ""}.`,
    );
  }
  if (change !== null) {
    score += change > 1 ? 1 : change < -1 ? -1 : 0;
    evidence.push(`24h move ${fmtPct(change, 2)}.`);
  }
  const lean = leanOf(score, 1.5);
  const stretched = (r4 ?? 50) >= 70 || (r4 ?? 50) <= 30;
  return {
    key: "momentum",
    lean,
    headline:
      lean === "neutral"
        ? "Momentum is flat to mixed."
        : `Momentum points ${lean}${stretched ? ", but it is stretched and can snap back" : ""}.`,
    evidence,
  };
}

export function positioningDriver(input: DeskInput): DeskDriverDto | null {
  const day = input.candles1h.slice(-24);
  const vol = day.reduce((s, c) => s + c.v, 0);
  const buy = day.reduce((s, c) => s + (c.takerBuyShare ?? 0.5) * c.v, 0);
  const taker = vol > 0 ? buy / vol : null;
  const first = day[0];
  const last = day.at(-1);
  const priceUp = first && last ? last.c >= first.o : null;
  const { oiChange24hPct: oi, fundingRate: f } = input;
  if (taker === null && oi === null && f === null) return null;
  let score = 0;
  const evidence: string[] = [];
  if (taker !== null) {
    score += taker > 0.52 ? 1 : taker < 0.48 ? -1 : 0;
    evidence.push(`Takers ${(taker * 100).toFixed(1)}% buying over 24h.`);
  }
  if (oi !== null && priceUp !== null) {
    // New money joining the move confirms it; falling OI means positions closing.
    if (oi > 2) score += priceUp ? 1 : -1;
    evidence.push(
      `Open interest ${fmtPct(oi)} in 24h${oi > 2 ? (priceUp ? ", rising with price" : ", rising while price fell") : oi < -2 ? ", positions closing" : ""}.`,
    );
  }
  if (f !== null) {
    // Very high funding = crowded longs paying to stay in; very negative = crowded shorts.
    const bp = f * 10_000;
    if (bp > 3) score -= 1;
    else if (bp < -1) score += 1;
    evidence.push(
      `Funding ${(f * 100).toFixed(4)}% per settlement${bp > 3 ? " (longs crowded, paying a high premium)" : bp < -1 ? " (shorts crowded, paying longs)" : " (normal)"}.`,
    );
  }
  const lean = leanOf(score, 1);
  return {
    key: "positioning",
    lean,
    headline:
      lean === "up"
        ? "Futures traders have been leaning in on the buy side."
        : lean === "down"
          ? "Futures positioning leans to the sell side."
          : "Futures positioning is balanced.",
    evidence,
  };
}

export function liquidityDriver(input: DeskInput): DeskDriverDto | null {
  const clusters = input.liqClusters;
  const price = input.live?.price ?? input.candles1h.at(-1)?.c;
  if (!clusters?.length || !price) return null;
  const near = (c: { price: number }) => Math.abs(c.price / price - 1) <= 0.08;
  const above = clusters.filter((c) => c.side === "short" && c.price > price && near(c));
  const below = clusters.filter((c) => c.side === "long" && c.price < price && near(c));
  const sum = (xs: typeof above) => xs.reduce((s, c) => s + c.usd, 0);
  const up = sum(above);
  const down = sum(below);
  const biggest = (xs: typeof above) => [...xs].sort((a, b) => b.usd - a.usd)[0];
  const evidence: string[] = [];
  const a = biggest(above);
  const b = biggest(below);
  if (a)
    evidence.push(
      `Largest short cluster above: ≈${compactUsd(a.usd)} at ${a.price.toPrecision(6)} (${fmtPct((a.price / price - 1) * 100)}).`,
    );
  if (b)
    evidence.push(
      `Largest long cluster below: ≈${compactUsd(b.usd)} at ${b.price.toPrecision(6)} (${fmtPct((b.price / price - 1) * 100)}).`,
    );
  evidence.push("Estimated from open interest; price often gravitates toward big clusters.");
  // Price tends to be drawn toward the larger pool of liquidations ("liquidity magnet").
  const lean: DeskLean =
    up > 1.5 * down && up > 0 ? "up" : down > 1.5 * up && down > 0 ? "down" : "neutral";
  return {
    key: "liquidity",
    lean,
    headline:
      lean === "up"
        ? "More estimated liquidations sit above price than below."
        : lean === "down"
          ? "More estimated liquidations sit below price than above."
          : up + down === 0
            ? "No large liquidation clusters within 8% of price."
            : "Liquidation clusters are similar above and below.",
    evidence,
  };
}

export function macroDriver(input: DeskInput): DeskDriverDto | null {
  const market = isMetal(input.symbol) ? "Gold" : "Crypto (BTC)";
  let score = 0;
  const evidence: string[] = [];
  for (const e of input.recentEvents) {
    if (e.currency !== "USD" && e.currency !== "ALL") continue;
    const r = marketReaction(e);
    if (!r.outcome || r.outcome === "inline") {
      if (e.actual)
        evidence.push(`${e.title}: ${e.actual} vs ${e.forecast ?? "no forecast"} (in line).`);
      continue;
    }
    const dir = (r.outcome === "higher" ? r.higher : r.lower).find((m) => m.market === market)?.dir;
    if (dir === "up") score += 1;
    if (dir === "down") score -= 1;
    evidence.push(
      `${e.title}: ${e.actual} vs ${e.forecast} forecast, ${r.outcome} than expected${dir ? `; usually ${dir === "up" ? "supports" : "weighs on"} ${isMetal(input.symbol) ? "metals" : "crypto"}` : ""}.`,
    );
  }
  // The next release is shown with a live countdown on the page, not frozen into the evidence.
  if (evidence.length === 0) {
    if (!input.nextEvent) return null;
    evidence.push("No high-impact US data in the last 24 hours.");
  }
  const lean = leanOf(score, 1);
  return {
    key: "macro",
    lean,
    headline:
      lean === "neutral"
        ? input.recentEvents.length
          ? "Recent US data has no clear tilt for this market."
          : "No high-impact US data in the last 24 hours."
        : `Recent US data has ${lean === "up" ? "supported" : "weighed on"} ${isMetal(input.symbol) ? "metals" : "crypto"}.`,
    evidence,
  };
}

export function moodDriver(input: DeskInput): DeskDriverDto | null {
  if (isMetal(input.symbol) || input.fearGreed === null) return null;
  const fg = input.fearGreed;
  const evidence = [`Fear & Greed ${Math.round(fg)}/100.`];
  if (input.btcDominance !== null)
    evidence.push(`Bitcoin dominance ${input.btcDominance.toFixed(1)}%.`);
  if (fg >= 80 || fg <= 20) evidence.push("Extreme readings often come before sharp reversals.");
  const lean: DeskLean = fg >= 55 ? "up" : fg <= 45 ? "down" : "neutral";
  return {
    key: "mood",
    lean,
    headline:
      lean === "up"
        ? "The crypto crowd is greedy."
        : lean === "down"
          ? "The crypto crowd is fearful."
          : "The crypto crowd is neutral.",
    evidence,
  };
}

/** Builds one market's desk (without the AI summary). Null when there is no price data. */
export function buildDesk(input: DeskInput): Omit<MarketDeskDto, "summary" | "summaryAt"> | null {
  const last = input.candles1h.at(-1);
  if (!last) return null;
  const drivers = [
    trendDriver(input.candles1h),
    momentumDriver(input.candles1h, input.live),
    positioningDriver(input),
    liquidityDriver(input),
    macroDriver(input),
    moodDriver(input),
  ].filter((d): d is DeskDriverDto => d !== null);

  return {
    symbol: input.symbol,
    name: DESK_NAMES[input.symbol],
    price: input.live?.price ?? last.c,
    change24hPct: dayChange(input.candles1h, input.live),
    computedAt: new Date(input.now).toISOString(),
    drivers,
    leans: tallyLeans(drivers),
    nextEvent: input.nextEvent,
    recentEvents: input.recentEvents,
  };
}
