import type { Candle } from "./indicators.js";

/**
 * Price-action / smart-money structure, defined precisely so results are reproducible:
 *  - Swing high/low: a candle whose high (low) is the extreme of `n` candles on each side.
 *  - BOS (break of structure): a close beyond the latest swing in the direction of the trend.
 *  - CHOCH (change of character): the first close beyond the latest swing against the trend.
 *  - FVG (fair value gap): a three-candle gap (candle 1 high below candle 3 low, or the reverse).
 *  - Order block: the last opposite-colour candle before the move that caused a BOS.
 *  - Breaker block: an order block later broken through after the move first made a further extreme
 *    (a liquidity sweep). Mitigation block: an order block broken through after a failure swing.
 *  - Liquidity pool: two or more swing highs (lows) within a small tolerance (equal highs/lows).
 *  - Premium/discount: position of price inside the latest swing range (above/below 50%).
 */

export interface Swing {
  index: number;
  t: number;
  price: number;
  kind: "HIGH" | "LOW";
}

export function swings(candles: readonly Candle[], n = 2, until = candles.length): Swing[] {
  const out: Swing[] = [];
  // A swing is only confirmed n candles later: never look past `until`.
  for (let i = n; i < Math.min(until, candles.length) - n; i++) {
    const c = candles[i] as Candle;
    let high = true;
    let low = true;
    for (let k = 1; k <= n; k++) {
      const a = candles[i - k] as Candle;
      const b = candles[i + k] as Candle;
      if (!(c.h > a.h && c.h >= b.h)) high = false;
      if (!(c.l < a.l && c.l <= b.l)) low = false;
    }
    if (high) out.push({ index: i, t: c.t, price: c.h, kind: "HIGH" });
    if (low) out.push({ index: i, t: c.t, price: c.l, kind: "LOW" });
  }
  return out;
}

export type Trend = "UP" | "DOWN" | "RANGE";

export interface StructureEvent {
  kind: "BOS" | "CHOCH";
  direction: "UP" | "DOWN";
  index: number;
  t: number;
  level: number;
}

export interface StructureResult {
  trend: Trend;
  events: StructureEvent[];
  lastHigh: Swing | null;
  lastLow: Swing | null;
}

/** Walks candles up to `until` (exclusive), tracking breaks of the latest confirmed swings. */
export function marketStructure(
  candles: readonly Candle[],
  until = candles.length,
  n = 2,
): StructureResult {
  const sw = swings(candles, n, until);
  let trend: Trend = "RANGE";
  const events: StructureEvent[] = [];
  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let brokenHigh = -1;
  let brokenLow = -1;
  let si = 0;
  for (let i = 0; i < Math.min(until, candles.length); i++) {
    // Swings become known n candles after they form.
    while (si < sw.length && (sw[si] as Swing).index + n <= i) {
      const s = sw[si] as Swing;
      if (s.kind === "HIGH") lastHigh = s;
      else lastLow = s;
      si++;
    }
    const c = candles[i] as Candle;
    if (lastHigh && lastHigh.index !== brokenHigh && c.c > lastHigh.price) {
      events.push({
        kind: trend === "DOWN" ? "CHOCH" : "BOS",
        direction: "UP",
        index: i,
        t: c.t,
        level: lastHigh.price,
      });
      trend = "UP";
      brokenHigh = lastHigh.index;
    } else if (lastLow && lastLow.index !== brokenLow && c.c < lastLow.price) {
      events.push({
        kind: trend === "UP" ? "CHOCH" : "BOS",
        direction: "DOWN",
        index: i,
        t: c.t,
        level: lastLow.price,
      });
      trend = "DOWN";
      brokenLow = lastLow.index;
    }
  }
  return { trend, events, lastHigh, lastLow };
}

export interface Zone {
  kind: "FVG" | "ORDER_BLOCK" | "BREAKER" | "MITIGATION";
  direction: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  /** Candle index where the zone formed. */
  index: number;
  t: number;
  /** Price traded back into the zone before `until`. */
  touched: boolean;
}

/** Fair value gaps formed before `until`, with whether price has since filled into them. */
export function fairValueGaps(candles: readonly Candle[], until = candles.length): Zone[] {
  const out: Zone[] = [];
  const end = Math.min(until, candles.length);
  for (let i = 2; i < end; i++) {
    const a = candles[i - 2] as Candle;
    const c = candles[i] as Candle;
    let zone: Omit<Zone, "touched"> | null = null;
    if (a.h < c.l)
      zone = {
        kind: "FVG",
        direction: "BULLISH",
        bottom: a.h,
        top: c.l,
        index: i - 1,
        t: (candles[i - 1] as Candle).t,
      };
    else if (a.l > c.h)
      zone = {
        kind: "FVG",
        direction: "BEARISH",
        bottom: c.h,
        top: a.l,
        index: i - 1,
        t: (candles[i - 1] as Candle).t,
      };
    if (!zone) continue;
    let touched = false;
    for (let k = i + 1; k < end && !touched; k++) {
      const x = candles[k] as Candle;
      touched = zone.direction === "BULLISH" ? x.l <= zone.top : x.h >= zone.bottom;
    }
    out.push({ ...zone, touched });
  }
  return out;
}

/** Order blocks behind each BOS/CHOCH, and whether they later became breaker or mitigation blocks. */
export function orderBlocks(candles: readonly Candle[], until = candles.length): Zone[] {
  const { events } = marketStructure(candles, until);
  const sw = swings(candles, 2, until);
  const end = Math.min(until, candles.length);
  const out: Zone[] = [];
  for (const e of events) {
    const bullish = e.direction === "UP";
    // Last opposite-colour candle before the breaking leg (search back up to 15 candles).
    let obIndex = -1;
    for (let k = e.index - 1; k >= Math.max(0, e.index - 15); k--) {
      const c = candles[k] as Candle;
      if (bullish ? c.c < c.o : c.c > c.o) {
        obIndex = k;
        break;
      }
    }
    if (obIndex < 0) continue;
    const ob = candles[obIndex] as Candle;
    let kind: Zone["kind"] = "ORDER_BLOCK";
    let touched = false;
    for (let k = e.index + 1; k < end; k++) {
      const x = candles[k] as Candle;
      if (bullish ? x.l <= ob.h : x.h >= ob.l) touched = true;
      const invalidated = bullish ? x.c < ob.l : x.c > ob.h;
      if (invalidated) {
        // Breaker: the move made a further extreme (took liquidity) before failing back through the
        // block. Mitigation: it failed without one (a lower high / higher low).
        const legSwings = sw.filter(
          (x) => x.index > e.index && x.index < k && x.kind === (bullish ? "HIGH" : "LOW"),
        );
        const first = legSwings[0];
        const swept = first
          ? legSwings
              .slice(1)
              .some((x) => (bullish ? x.price > first.price : x.price < first.price))
          : false;
        kind = swept ? "BREAKER" : "MITIGATION";
        break;
      }
    }
    // A broken block flips: a failed bullish block acts as resistance (bearish), and vice versa.
    const direction =
      kind === "ORDER_BLOCK" ? (bullish ? "BULLISH" : "BEARISH") : bullish ? "BEARISH" : "BULLISH";
    out.push({ kind, direction, top: ob.h, bottom: ob.l, index: obIndex, t: ob.t, touched });
  }
  return out;
}

export interface Level {
  price: number;
  kind: "SUPPORT" | "RESISTANCE";
  touches: number;
}

/** Support/resistance: swing prices that cluster within `tolerance` (absolute price). */
export function levels(candles: readonly Candle[], until: number, tolerance: number): Level[] {
  const sw = swings(candles, 2, until);
  const clusters: { sum: number; count: number; highs: number; lows: number }[] = [];
  for (const s of sw) {
    const hit = clusters.find((c) => Math.abs(c.sum / c.count - s.price) <= tolerance);
    if (hit) {
      hit.sum += s.price;
      hit.count += 1;
      if (s.kind === "HIGH") hit.highs += 1;
      else hit.lows += 1;
    } else
      clusters.push({
        sum: s.price,
        count: 1,
        highs: s.kind === "HIGH" ? 1 : 0,
        lows: s.kind === "LOW" ? 1 : 0,
      });
  }
  const last = (candles[Math.min(until, candles.length) - 1] as Candle | undefined)?.c ?? 0;
  return clusters
    .filter((c) => c.count >= 2)
    .map((c) => {
      const price = c.sum / c.count;
      return { price, kind: price <= last ? "SUPPORT" : "RESISTANCE", touches: c.count } as Level;
    });
}

export interface LiquidityPool {
  side: "BUY_SIDE" | "SELL_SIDE";
  price: number;
  swings: number;
  /** Price traded through the pool (took the stops) before `until`. */
  swept: boolean;
  sweptAt: number | null;
}

/** Equal highs (buy-side liquidity) and equal lows (sell-side), and whether they were swept. */
export function liquidityPools(
  candles: readonly Candle[],
  until: number,
  tolerancePct = 0.001,
): LiquidityPool[] {
  const sw = swings(candles, 2, until);
  const end = Math.min(until, candles.length);
  const out: LiquidityPool[] = [];
  for (const kind of ["HIGH", "LOW"] as const) {
    const list = sw.filter((s) => s.kind === kind);
    const used = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      const a = list[i] as Swing;
      const group = [a];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Swing;
        if (Math.abs(b.price - a.price) / a.price <= tolerancePct) {
          group.push(b);
          used.add(j);
        }
      }
      if (group.length < 2) continue;
      const price =
        kind === "HIGH"
          ? Math.max(...group.map((g) => g.price))
          : Math.min(...group.map((g) => g.price));
      const after = Math.max(...group.map((g) => g.index)) + 1;
      let sweptAt: number | null = null;
      for (let k = after; k < end; k++) {
        const x = candles[k] as Candle;
        if (kind === "HIGH" ? x.h > price : x.l < price) {
          sweptAt = x.t;
          break;
        }
      }
      out.push({
        side: kind === "HIGH" ? "BUY_SIDE" : "SELL_SIDE",
        price,
        swings: group.length,
        swept: sweptAt !== null,
        sweptAt,
      });
    }
  }
  return out;
}

/** Where price sits in the latest swing range: 0 = range low, 1 = range high. */
export function rangePosition(
  price: number,
  high: number | null,
  low: number | null,
): number | null {
  if (high === null || low === null || high <= low) return null;
  return (price - low) / (high - low);
}
