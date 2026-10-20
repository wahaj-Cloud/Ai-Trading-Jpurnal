import type { ExchangeId } from "./exchanges.js";

/**
 * One-tap trade plan: when an alert fires, the trader's own rules (stop in typical 5-minute
 * ranges, target in R, money at risk) are turned into numbers they can copy into their exchange.
 * WickMentor never places the order; the trader chooses whether and which way to trade.
 */

export interface TradePlanRules {
  /** Stop distance in typical 5-minute ranges (ATR). */
  stopRanges: number;
  /** Target as a multiple of the stop distance. */
  targetR: number;
  /** Money to lose if the stop is hit (null = no size). */
  riskUsd: number | null;
  /** Taker fee per fill, in basis points (Binance USDⓈ-M default 5). */
  feeBps?: number;
}

export interface TradePlan {
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target: number;
  /** Stop distance as a share of the entry price, %. */
  stopPct: number;
  /** Quantity in coins (4 significant figures, rounded down: the loss stays within the risk). */
  qty: number | null;
  notionalUsd: number | null;
  /** Loss at the stop including both fees, and gain at the target after both fees. */
  lossAtStopUsd: number | null;
  gainAtTargetUsd: number | null;
  /** Reward to risk after fees (lower than the target R because fees cost on both sides). */
  rrAfterFees: number;
}

export const DEFAULT_PLAN_RULES: TradePlanRules = { stopRanges: 1.5, targetR: 2, riskUsd: null };

/**
 * Rounds a quantity down to 4 significant figures, so the loss at the stop never exceeds the money
 * at risk. Exchanges have their own step sizes: round down further there if asked.
 */
export function roundQty(qty: number): number {
  if (!(qty > 0) || !Number.isFinite(qty)) return 0;
  const decimals = 3 - Math.floor(Math.log10(qty));
  if (decimals <= 0) {
    const f = 10 ** -decimals;
    return Math.floor(qty / f) * f;
  }
  const f = 10 ** decimals;
  return Number((Math.floor(qty * f + 1e-9) / f).toFixed(decimals));
}

export function buildTradePlan(x: {
  side: "LONG" | "SHORT";
  price: number;
  /** Typical 5-minute range (ATR) in price. */
  atr5m: number | null;
  rules: TradePlanRules;
}): TradePlan | null {
  const { side, price, atr5m, rules } = x;
  if (!(price > 0) || !(atr5m !== null && atr5m > 0)) return null;
  const s = side === "LONG" ? 1 : -1;
  const dist = rules.stopRanges * atr5m;
  if (side === "LONG" && dist >= price) return null;
  const stop = price - s * dist;
  const target = price + s * rules.targetR * dist;
  const fee = (rules.feeBps ?? 5) / 10_000;
  // Per coin: loss = dist + fees on entry and stop; gain = R·dist − fees on entry and target.
  const lossPer = dist + fee * (price + stop);
  const gainPer = rules.targetR * dist - fee * (price + target);
  let qty: number | null = null;
  if (rules.riskUsd !== null && rules.riskUsd > 0) qty = roundQty(rules.riskUsd / lossPer);
  return {
    side,
    entry: price,
    stop,
    target,
    stopPct: (dist / price) * 100,
    qty,
    notionalUsd: qty === null ? null : qty * price,
    lossAtStopUsd: qty === null ? null : qty * lossPer,
    gainAtTargetUsd: qty === null ? null : qty * gainPer,
    rrAfterFees: gainPer / lossPer,
  };
}

/** Where the trader can open the market on an exchange. MetaTrader brokers have no web link. */
export function exchangeTradeUrl(exchange: ExchangeId, symbol: string): string | null {
  const base = symbol.replace(/USDT$/, "");
  switch (exchange) {
    case "BINANCE":
      return `https://www.binance.com/en/futures/${symbol}`;
    case "BYBIT":
      return `https://www.bybit.com/trade/usdt/${symbol}`;
    case "OKX":
      return `https://www.okx.com/trade-swap/${base.toLowerCase()}-usdt-swap`;
    case "MEXC":
      return `https://futures.mexc.com/exchange/${base}_USDT`;
    case "KUCOIN":
      return `https://www.kucoin.com/trade/futures/${base === "BTC" ? "XBT" : base}USDTM`;
    case "BINGX":
      return `https://bingx.com/en/perpetual/${base}-USDT/`;
    default:
      return null;
  }
}

/**
 * The plan behind an alert, carried in its link: the price and typical range when it fired and
 * the trader's rules. The Cockpit rebuilds both sides from it, so the link never names a side.
 */
export interface PlanSnapshot {
  entry: number;
  atr5m: number;
  rules: TradePlanRules;
  at: number;
}

export function planToQuery(p: PlanSnapshot): string {
  // Ten significant figures: exact for any price, short enough for a link.
  const short = (v: number) => String(Number(v.toPrecision(10)));
  const q = new URLSearchParams({
    entry: short(p.entry),
    atr: short(p.atr5m),
    sr: String(p.rules.stopRanges),
    tr: String(p.rules.targetR),
    at: String(p.at),
  });
  if (p.rules.riskUsd !== null) q.set("risk", String(p.rules.riskUsd));
  return q.toString();
}

export function planFromQuery(
  q: Record<string, string | string[] | undefined>,
): PlanSnapshot | null {
  const n = (k: string, min: number, max: number) => {
    const raw = q[k];
    if (typeof raw !== "string" || raw === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) && v >= min && v <= max ? v : null;
  };
  const entry = n("entry", Number.MIN_VALUE, 1e9);
  const atr = n("atr", Number.MIN_VALUE, 1e9);
  const sr = n("sr", 0.3, 10);
  const tr = n("tr", 0.3, 10);
  const at = n("at", 1, 8.64e15);
  if (entry === null || atr === null || sr === null || tr === null || at === null) return null;
  return {
    entry,
    atr5m: atr,
    rules: { stopRanges: sr, targetR: tr, riskUsd: n("risk", 1, 1e7) },
    at,
  };
}

/** Both sides of a plan, so the trader decides the direction. */
export function planBothSides(p: Omit<PlanSnapshot, "at">): {
  long: TradePlan | null;
  short: TradePlan | null;
} {
  const one = (side: "LONG" | "SHORT") =>
    buildTradePlan({ side, price: p.entry, atr5m: p.atr5m, rules: p.rules });
  return { long: one("LONG"), short: one("SHORT") };
}

/** The plan lines of an alert: the trader's own rules applied both ways, never a call to trade. */
export function planLine(p: Omit<PlanSnapshot, "at">, fmt: (n: number) => string): string {
  const { long, short } = planBothSides(p);
  if (!long || !short) return "";
  const size =
    long.qty !== null && long.lossAtStopUsd !== null
      ? ` Size ${long.qty} (about $${long.lossAtStopUsd.toFixed(2)} lost at the stop, fees included).`
      : "";
  return `Your plan from ${fmt(p.entry)} (your rules): long → stop ${fmt(long.stop)}, target ${fmt(long.target)}; short → stop ${fmt(short.stop)}, target ${fmt(short.target)}; about ${Math.min(long.rrAfterFees, short.rrAfterFees).toFixed(2)}R after fees.${size} Which way, and whether at all, is your call.`;
}
