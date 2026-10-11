import type {
  ContextCheckCode,
  ContextCheckDto,
  Timeframe,
  TradeContextDto,
  ZoneRefDto,
} from "@atc/shared";
import { atr, type Candle, ema, rsi, sessionVwap, sma } from "./indicators.js";
import {
  fairValueGaps,
  levels,
  liquidityPools,
  marketStructure,
  orderBlocks,
  rangePosition,
} from "./structure.js";

export const CONTEXT_VERSION = 1;
/** Candles needed before entry so a 200-period EMA is meaningful. */
export const WARMUP_CANDLES = 250;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
};

/** Chart timeframe matched to how long the trade was held (a scalp is judged on 5-minute candles). */
export function timeframeFor(holdingSeconds: number | null): Timeframe {
  const h = (holdingSeconds ?? 0) / 3600;
  if (h < 2) return "5m";
  if (h < 12) return "15m";
  if (h < 72) return "1h";
  return "4h";
}

export interface ContextTrade {
  direction: "LONG" | "SHORT";
  openedAt: Date;
  closedAt: Date | null;
  entryPrice: number;
  exitPrice: number | null;
  stopPrice: number | null;
}

const LABELS: Record<ContextCheckCode, string> = {
  TREND_ALIGNED: "Traded with the market structure",
  EMA_ALIGNED: "Price on the right side of the 50 EMA",
  VALUE_ENTRY: "Entered near value (EMA 20 or VWAP)",
  NOT_EXTENDED: "Did not chase an extended move",
  PREMIUM_DISCOUNT: "Bought in discount / sold in premium",
  STRUCTURE_CONFIRMED: "Recent break of structure in your direction",
  ZONE_CONFLUENCE: "Entered at a fair value gap or order block",
  LIQUIDITY_SWEPT: "Liquidity was swept before entry",
  VOLUME_CONFIRMED: "Above-average volume into the entry",
  EXIT_EFFICIENCY: "Kept at least half of the best move",
  HELD_GAINS: "Did not let a good move turn into a loss",
};

const r = (v: number | null | undefined, dp = 6) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(dp));

/** Index of the last candle that opened at or before `t`. */
function indexAt(candles: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((candles[mid] as Candle).t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Market context of one trade from candles of one timeframe. Only candles that had closed before the
 * entry are used for entry readings (no look-ahead); candles during the trade give the excursion.
 */
export function analyzeTrade(
  candles: readonly Candle[],
  trade: ContextTrade,
  timeframe: Timeframe,
  source: string,
): TradeContextDto | null {
  const tfMs = TIMEFRAME_MS[timeframe];
  const entryT = trade.openedAt.getTime();
  // The candle containing the entry is still forming: readings use the one before it.
  const entryIdx = indexAt(candles, entryT - tfMs);
  if (entryIdx < 30) return null;
  const until = entryIdx + 1;
  const long = trade.direction === "LONG";
  const price = trade.entryPrice;
  const closes = candles.map((c) => c.c);
  const e20 = ema(closes, 20)[entryIdx] ?? null;
  const e50 = ema(closes, 50)[entryIdx] ?? null;
  const e200 = ema(closes, 200)[entryIdx] ?? null;
  const rsiNow = rsi(closes, 14)[entryIdx] ?? null;
  const atrNow = atr(candles, 14)[entryIdx] ?? null;
  const vwapNow = sessionVwap(candles)[entryIdx] ?? null;
  const volSma = sma(
    candles.map((c) => c.v),
    20,
  );
  const recentVol = candles.slice(Math.max(0, until - 3), until).reduce((s, c) => s + c.v, 0) / 3;
  const volAvg = volSma[entryIdx] ?? null;
  const volumeRatio = volAvg && volAvg > 0 ? recentVol / volAvg : null;

  const structure = marketStructure(candles, until);
  const lastEvent = structure.events.at(-1) ?? null;
  const pos = rangePosition(
    price,
    structure.lastHigh?.price ?? null,
    structure.lastLow?.price ?? null,
  );
  const zone =
    pos === null ? null : pos > 0.55 ? "PREMIUM" : pos < 0.45 ? "DISCOUNT" : "EQUILIBRIUM";
  const tolerance = (atrNow ?? price * 0.002) * 0.5;
  const lv = levels(candles, until, tolerance);
  const support =
    lv.filter((l) => l.price <= price).sort((a, b) => b.price - a.price)[0]?.price ?? null;
  const resistance =
    lv.filter((l) => l.price > price).sort((a, b) => a.price - b.price)[0]?.price ?? null;

  const inside = (z: { top: number; bottom: number }) =>
    price <= z.top * 1.0005 && price >= z.bottom * 0.9995;
  const zones: ZoneRefDto[] = [...fairValueGaps(candles, until), ...orderBlocks(candles, until)]
    .filter((z) => inside(z))
    .slice(-4)
    .map((z) => ({ kind: z.kind, direction: z.direction, top: z.top, bottom: z.bottom }));
  const pools = liquidityPools(candles, until);
  const recentSweep = pools
    .filter(
      (p) =>
        p.swept &&
        p.sweptAt !== null &&
        p.sweptAt >= (candles[Math.max(0, until - 20)] as Candle).t,
    )
    .sort((a, b) => (b.sweptAt ?? 0) - (a.sweptAt ?? 0))[0];

  const stretch = e20 !== null && atrNow ? (price - e20) / atrNow : null;
  const directional = stretch === null ? null : long ? stretch : -stretch;
  const extendedEntry =
    (directional !== null && directional > 2.5) ||
    (rsiNow !== null && (long ? rsiNow >= 75 : rsiNow <= 25));

  const checks: ContextCheckDto[] = [];
  const check = (
    code: ContextCheckCode,
    ok: boolean | null,
    detail: string,
    phase: "ENTRY" | "EXIT" = "ENTRY",
  ) => checks.push({ code, label: LABELS[code], ok, detail, phase });

  check(
    "TREND_ALIGNED",
    structure.trend === "RANGE" ? null : structure.trend === (long ? "UP" : "DOWN"),
    `Structure was ${structure.trend === "RANGE" ? "ranging" : `trending ${structure.trend.toLowerCase()}`} on the ${timeframe} chart.`,
  );
  check(
    "EMA_ALIGNED",
    e50 === null ? null : long ? price > e50 : price < e50,
    e50 === null
      ? "Not enough history for the 50 EMA."
      : `Entry ${price > e50 ? "above" : "below"} the 50 EMA (${r(e50, 6)}).`,
  );
  const nearVwap = vwapNow !== null && atrNow ? Math.abs(price - vwapNow) <= 0.5 * atrNow : false;
  check(
    "VALUE_ENTRY",
    stretch === null ? null : Math.abs(stretch) <= 1 || nearVwap,
    stretch === null
      ? "Not measurable."
      : `Entry was ${Math.abs(stretch).toFixed(1)} ATR from the 20 EMA${nearVwap ? ", close to VWAP" : ""}.`,
  );
  check(
    "NOT_EXTENDED",
    directional === null && rsiNow === null ? null : !extendedEntry,
    `RSI ${rsiNow === null ? "unknown" : rsiNow.toFixed(0)}; ${directional === null ? "" : `${directional.toFixed(1)} ATR stretched in your direction.`}`.trim(),
  );
  check(
    "PREMIUM_DISCOUNT",
    zone === null || zone === "EQUILIBRIUM"
      ? null
      : long
        ? zone === "DISCOUNT"
        : zone === "PREMIUM",
    zone === null
      ? "No clear swing range."
      : (pos ?? 0) < 0
        ? "Entry below the latest swing range (deep discount)."
        : (pos ?? 0) > 1
          ? "Entry above the latest swing range (deep premium)."
          : `Entry in the ${zone.toLowerCase()} half of the swing range (${((pos ?? 0) * 100).toFixed(0)}%).`,
  );
  const candlesBefore = lastEvent ? entryIdx - lastEvent.index : null;
  check(
    "STRUCTURE_CONFIRMED",
    lastEvent === null || (candlesBefore ?? 0) > 50
      ? false
      : lastEvent.direction === (long ? "UP" : "DOWN"),
    lastEvent
      ? `Last ${lastEvent.kind} was ${lastEvent.direction.toLowerCase()}, ${candlesBefore} candles before entry.`
      : "No break of structure before entry.",
  );
  const matching = zones.filter((z) => z.direction === (long ? "BULLISH" : "BEARISH"));
  check(
    "ZONE_CONFLUENCE",
    matching.length > 0,
    matching.length
      ? `Inside a ${matching.map((z) => z.kind.toLowerCase().replace("_", " ")).join(" and ")}.`
      : "No fair value gap or order block at the entry.",
  );
  const helpfulSweep = recentSweep && recentSweep.side === (long ? "SELL_SIDE" : "BUY_SIDE");
  check(
    "LIQUIDITY_SWEPT",
    helpfulSweep ? true : null,
    helpfulSweep
      ? `${long ? "Sell" : "Buy"}-side liquidity at ${r(recentSweep.price)} was taken shortly before entry.`
      : "No recent liquidity sweep.",
  );
  check(
    "VOLUME_CONFIRMED",
    volumeRatio === null ? null : volumeRatio >= 1.2,
    volumeRatio === null
      ? "Volume not available."
      : `Volume into entry was ${volumeRatio.toFixed(1)}× its 20-candle average.`,
  );

  // Excursion while the trade was open.
  let excursion: TradeContextDto["excursion"] = null;
  let exit: TradeContextDto["exit"] = null;
  if (trade.closedAt && trade.exitPrice !== null) {
    const from = indexAt(candles, entryT);
    const to = indexAt(candles, trade.closedAt.getTime());
    if (from >= 0 && to >= from) {
      const during = candles.slice(from, to + 1);
      const best = long ? Math.max(...during.map((c) => c.h)) : Math.min(...during.map((c) => c.l));
      const worst = long
        ? Math.min(...during.map((c) => c.l))
        : Math.max(...during.map((c) => c.h));
      const mfe = Math.max(0, long ? best - price : price - best);
      const mae = Math.max(0, long ? price - worst : worst - price);
      const risk = trade.stopPrice !== null ? Math.abs(price - trade.stopPrice) : null;
      const captured = long ? trade.exitPrice - price : price - trade.exitPrice;
      const efficiency = mfe > 0 ? Math.max(-1, Math.min(1, captured / mfe)) : null;
      excursion = {
        mfe: r(mfe) ?? 0,
        mae: r(mae) ?? 0,
        mfeR: risk ? r(mfe / risk, 2) : null,
        maeR: risk ? r(mae / risk, 2) : null,
        efficiency: r(efficiency, 2),
      };
      const exitStructure = marketStructure(candles, to + 1);
      exit = {
        price: trade.exitPrice,
        trend: exitStructure.trend,
        rsi: r(rsi(closes, 14)[to] ?? null, 1),
      };
      check(
        "EXIT_EFFICIENCY",
        efficiency === null || captured <= 0 ? null : efficiency >= 0.5,
        efficiency === null
          ? "Price never moved in your favour."
          : `You kept ${(efficiency * 100).toFixed(0)}% of the best move available.`,
        "EXIT",
      );
      const bigMove = risk ? mfe >= risk : atrNow ? mfe >= atrNow : false;
      check(
        "HELD_GAINS",
        bigMove ? captured > 0 : null,
        bigMove
          ? `The trade was up ${risk ? `${(mfe / risk).toFixed(1)}R` : `${(mfe / (atrNow as number)).toFixed(1)} ATR`} at best and closed ${captured > 0 ? "in profit" : "at a loss"}.`
          : "The trade never had a large open profit.",
        "EXIT",
      );
    }
  }

  const applicable = checks.filter(
    (c) => c.phase === "ENTRY" && c.ok !== null && c.code !== "LIQUIDITY_SWEPT",
  );
  const entryScore = applicable.length
    ? Math.round((applicable.filter((c) => c.ok).length / applicable.length) * 100)
    : null;

  return {
    version: CONTEXT_VERSION,
    timeframe,
    source,
    entry: {
      price,
      trend: structure.trend,
      lastStructure: lastEvent
        ? {
            kind: lastEvent.kind,
            direction: lastEvent.direction,
            candlesBefore: entryIdx - lastEvent.index,
          }
        : null,
      ema20: r(e20),
      ema50: r(e50),
      ema200: r(e200),
      rsi: r(rsiNow, 1),
      vwap: r(vwapNow),
      atr: r(atrNow),
      volumeRatio: r(volumeRatio, 2),
      stretchAtr: r(stretch, 2),
      rangePosition: r(pos, 2),
      zone,
      support: r(support),
      resistance: r(resistance),
      zones,
      liquiditySwept: recentSweep ? { side: recentSweep.side, price: recentSweep.price } : null,
    },
    exit,
    excursion,
    checks,
    entryScore,
    extendedEntry,
  };
}

/** Compact factual summary for the AI review prompt. */
export function contextFacts(ctx: TradeContextDto): string {
  const e = ctx.entry;
  const lines = [
    `- Timeframe ${ctx.timeframe} (${ctx.source} candles). Structure at entry: ${e.trend.toLowerCase()}${e.lastStructure ? `; last ${e.lastStructure.kind} ${e.lastStructure.direction.toLowerCase()} ${e.lastStructure.candlesBefore} candles earlier` : ""}.`,
    `- EMA20 ${e.ema20 ?? "n/a"}, EMA50 ${e.ema50 ?? "n/a"}, EMA200 ${e.ema200 ?? "n/a"}; RSI ${e.rsi ?? "n/a"}; VWAP ${e.vwap ?? "n/a"}; ATR ${e.atr ?? "n/a"}; volume ${e.volumeRatio ?? "n/a"}× average.`,
    `- Entry ${e.stretchAtr ?? "n/a"} ATR from EMA20; ${e.zone ? `${e.zone.toLowerCase()} of the swing range` : "no clear range"}; support ${e.support ?? "none"}, resistance ${e.resistance ?? "none"}.`,
    `- Zones at entry: ${e.zones.map((z) => `${z.direction.toLowerCase()} ${z.kind.toLowerCase().replace("_", " ")}`).join(", ") || "none"}. Liquidity sweep before entry: ${e.liquiditySwept ? `${e.liquiditySwept.side.toLowerCase().replace("_", "-")} at ${e.liquiditySwept.price}` : "none"}.`,
    ctx.excursion
      ? `- While open: best move ${ctx.excursion.mfe}${ctx.excursion.mfeR !== null ? ` (${ctx.excursion.mfeR}R)` : ""}, worst ${ctx.excursion.mae}${ctx.excursion.maeR !== null ? ` (${ctx.excursion.maeR}R)` : ""}; exit kept ${ctx.excursion.efficiency === null ? "n/a" : `${Math.round(ctx.excursion.efficiency * 100)}%`} of the best move.`
      : "",
    `- Entry checklist (${ctx.entryScore ?? "n/a"}% in your favour): ${ctx.checks.map((c) => `${c.label}: ${c.ok === null ? "n/a" : c.ok ? "yes" : "no"}`).join("; ")}.`,
    ctx.extendedEntry ? "- The entry chased an extended move." : "",
  ];
  return lines.filter(Boolean).join("\n");
}
