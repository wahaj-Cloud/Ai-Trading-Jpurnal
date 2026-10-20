import {
  describeCondition,
  SETUP_WINDOW,
  type SetupCondition,
  type SetupRule,
  type SweepTarget,
} from "@atc/shared";
import { type Candle, ema, rsi, sessionVwap } from "./indicators.js";
import { marketStructure, rangePosition, type StructureResult, swings } from "./structure.js";

/**
 * The one evaluator behind My Setup Alerts, the setup preview and Strategy Lab. A rule is checked on
 * a closed candle using only the SETUP_WINDOW candles that end with it: live scans fetch exactly
 * that window, so a backtest and a live alert on the same candles always give the same answer, and
 * adding later candles can never change an earlier result (no look-ahead).
 */

/** Fewer candles than this and no rule is checked (indicators would be meaningless). */
export const SETUP_MIN_CANDLES = 50;
const DAY_MS = 86_400_000;
const ASIA_END_MS = 7 * 3_600_000;

export interface SetupMatch {
  matched: boolean;
  /** Plain-language conditions (all of them when matched). */
  labels: string[];
}

/** Lazily computed readings over one window, shared by the rule's conditions. */
class WindowReadings {
  private emas = new Map<number, (number | null)[]>();
  private rsis = new Map<number, (number | null)[]>();
  private vwap: number[] | null = null;
  private structure: StructureResult | null = null;
  private swingList: ReturnType<typeof swings> | null = null;
  readonly closes: number[];
  readonly j: number;

  constructor(readonly w: readonly Candle[]) {
    this.closes = w.map((c) => c.c);
    this.j = w.length - 1;
  }

  ema(period: number): number | null {
    let s = this.emas.get(period);
    if (!s) {
      s = ema(this.closes, period);
      this.emas.set(period, s);
    }
    return s[this.j] ?? null;
  }

  rsi(period: number): number | null {
    let s = this.rsis.get(period);
    if (!s) {
      s = rsi(this.closes, period);
      this.rsis.set(period, s);
    }
    return s[this.j] ?? null;
  }

  vwapNow(): number | null {
    this.vwap ??= sessionVwap(this.w);
    return this.vwap[this.j] ?? null;
  }

  structureNow(): StructureResult {
    this.structure ??= marketStructure(this.w, this.w.length);
    return this.structure;
  }

  swings() {
    this.swingList ??= swings(this.w, 2, this.w.length);
    return this.swingList;
  }
}

/** The level a sweep is measured against, as known when candle `k` opened. */
function sweepLevel(r: WindowReadings, target: SweepTarget, k: number): number | null {
  const w = r.w;
  const c = w[k] as Candle;
  switch (target) {
    case "swing_low":
    case "swing_high": {
      const kind = target === "swing_low" ? "LOW" : "HIGH";
      // A swing is confirmed two candles after it forms; only confirmed swings before k count.
      const list = r.swings().filter((s) => s.kind === kind && s.index + 2 < k);
      return list.at(-1)?.price ?? null;
    }
    case "asia_low":
    case "asia_high": {
      const dayStart = Math.floor(c.t / DAY_MS) * DAY_MS;
      // The Asian range is only complete once the session has ended, and only known when the
      // window reaches back to the start of the day.
      if (c.t < dayStart + ASIA_END_MS || (w[0] as Candle).t > dayStart) return null;
      let level: number | null = null;
      for (let x = k - 1; x >= 0; x--) {
        const p = w[x] as Candle;
        if (p.t < dayStart) break;
        if (p.t >= dayStart + ASIA_END_MS) continue;
        level =
          target === "asia_low"
            ? Math.min(level ?? Number.POSITIVE_INFINITY, p.l)
            : Math.max(level ?? Number.NEGATIVE_INFINITY, p.h);
      }
      return level;
    }
    case "prev_day_low":
    case "prev_day_high": {
      const dayStart = Math.floor(c.t / DAY_MS) * DAY_MS;
      // A partial previous day would give a wrong high/low: unknown instead.
      if ((w[0] as Candle).t > dayStart - DAY_MS) return null;
      let level: number | null = null;
      for (let x = k - 1; x >= 0; x--) {
        const p = w[x] as Candle;
        if (p.t >= dayStart) continue;
        if (p.t < dayStart - DAY_MS) break;
        level =
          target === "prev_day_low"
            ? Math.min(level ?? Number.POSITIVE_INFINITY, p.l)
            : Math.max(level ?? Number.NEGATIVE_INFINITY, p.h);
      }
      return level;
    }
  }
}

function sweptRecently(r: WindowReadings, target: SweepTarget, within: number): boolean {
  const low = target.endsWith("low");
  for (let k = r.j; k > r.j - within && k > 0; k--) {
    const level = sweepLevel(r, target, k);
    if (level === null) continue;
    const c = r.w[k] as Candle;
    // A sweep: the wick takes the level, the candle closes back on the other side.
    if (low ? c.l < level && c.c > level : c.h > level && c.c < level) return true;
  }
  return false;
}

/** Three-candle gaps whose third candle closed within the last `within` candles. */
function fvgCheck(
  r: WindowReadings,
  bullish: boolean,
  state: "formed" | "retest",
  within: number,
): boolean {
  const w = r.w;
  const j = r.j;
  const lastThird = state === "formed" ? j : j - 1;
  for (let third = lastThird; third >= Math.max(2, j - within); third--) {
    const a = w[third - 2] as Candle;
    const c = w[third] as Candle;
    const top = bullish ? c.l : a.l;
    const bottom = bullish ? a.h : c.h;
    if (!(bullish ? a.h < c.l : a.l > c.h)) continue;
    let touched = false;
    for (let k = third + 1; k < j && !touched; k++) {
      const x = w[k] as Candle;
      touched = bullish ? x.l <= top : x.h >= bottom;
    }
    if (touched) continue;
    if (state === "formed") {
      const now = w[j] as Candle;
      // Still open after the current candle closed.
      if (third === j || (bullish ? now.l > top : now.h < bottom)) return true;
    } else {
      const now = w[j] as Candle;
      // First trade back into the gap, closing without breaking through it.
      if (bullish ? now.l <= top && now.c >= bottom : now.h >= bottom && now.c <= top) return true;
    }
  }
  return false;
}

function orderBlockTap(r: WindowReadings, bullish: boolean, within: number): boolean {
  const w = r.w;
  const j = r.j;
  const now = w[j] as Candle;
  const { events } = r.structureNow();
  for (const e of events) {
    if (e.index < j - within || e.index >= j) continue;
    if ((e.direction === "UP") !== bullish) continue;
    let ob = -1;
    for (let k = e.index - 1; k >= Math.max(0, e.index - 15); k--) {
      const c = w[k] as Candle;
      if (bullish ? c.c < c.o : c.c > c.o) {
        ob = k;
        break;
      }
    }
    if (ob < 0) continue;
    const block = w[ob] as Candle;
    let broken = false;
    for (let k = e.index + 1; k < j && !broken; k++) {
      const x = w[k] as Candle;
      broken = bullish ? x.c < block.l : x.c > block.h;
    }
    if (broken) continue;
    if (bullish ? now.l <= block.h && now.c >= block.l : now.h >= block.l && now.c <= block.h)
      return true;
  }
  return false;
}

function sessionOfHour(h: number): "asia" | "london" | "new_york" | null {
  if (h < 7) return "asia";
  if (h < 13) return "london";
  if (h < 21) return "new_york";
  return null;
}

function check(cond: SetupCondition, r: WindowReadings): boolean {
  const now = r.w[r.j] as Candle;
  switch (cond.type) {
    case "ema_trend": {
      const f = r.ema(cond.fast);
      const s = r.ema(cond.slow);
      if (f === null || s === null) return false;
      return cond.direction === "up" ? f > s : f < s;
    }
    case "price_vs_ema": {
      const e = r.ema(cond.period);
      if (e === null) return false;
      return cond.side === "above" ? now.c > e : now.c < e;
    }
    case "rsi": {
      const v = r.rsi(cond.period);
      if (v === null) return false;
      return cond.op === "above" ? v > cond.value : v < cond.value;
    }
    case "price_vs_vwap": {
      const v = r.vwapNow();
      if (v === null) return false;
      return cond.side === "above" ? now.c > v : now.c < v;
    }
    case "liquidity_sweep":
      return sweptRecently(r, cond.of, cond.withinCandles);
    case "fvg":
      return fvgCheck(r, cond.bias === "bullish", cond.state, cond.withinCandles);
    case "order_block":
      return orderBlockTap(r, cond.bias === "bullish", cond.withinCandles);
    case "structure": {
      const dir = cond.bias === "bullish" ? "UP" : "DOWN";
      return r
        .structureNow()
        .events.some(
          (e) =>
            e.index > r.j - cond.withinCandles &&
            e.direction === dir &&
            (cond.event === "any" || e.kind === cond.event),
        );
    }
    case "session": {
      const s = sessionOfHour(new Date(now.t).getUTCHours());
      return s !== null && cond.in.includes(s);
    }
    case "volume_spike": {
      const from = Math.max(0, r.j - 20);
      const prev = r.w.slice(from, r.j);
      if (prev.length < 10) return false;
      const avg = prev.reduce((a, c) => a + c.v, 0) / prev.length;
      return avg > 0 && now.v >= avg * cond.multiple;
    }
    case "premium_discount": {
      const st = r.structureNow();
      const pos = rangePosition(now.c, st.lastHigh?.price ?? null, st.lastLow?.price ?? null);
      if (pos === null) return false;
      return cond.zone === "discount" ? pos < 0.5 : pos > 0.5;
    }
  }
}

/** The SETUP_WINDOW candles that end with candle `i` (inclusive). */
export function setupWindow(candles: readonly Candle[], i: number): readonly Candle[] {
  return candles.slice(Math.max(0, i - SETUP_WINDOW + 1), i + 1);
}

/** Checks a rule on the close of candle `i`, seeing only that candle and the ones before it. */
export function evaluateSetupAt(
  rule: SetupRule,
  candles: readonly Candle[],
  i: number,
): SetupMatch {
  const labels = rule.all.map(describeCondition);
  if (i < SETUP_MIN_CANDLES - 1 || i >= candles.length) return { matched: false, labels };
  const r = new WindowReadings(setupWindow(candles, i));
  for (const cond of rule.all) if (!check(cond, r)) return { matched: false, labels };
  return { matched: true, labels };
}

/** Every candle index in [from, to] where the rule matched on close (for previews). */
export function scanSetup(
  rule: SetupRule,
  candles: readonly Candle[],
  from = 0,
  to = candles.length - 1,
): number[] {
  const out: number[] = [];
  for (let i = Math.max(from, SETUP_MIN_CANDLES - 1); i <= Math.min(to, candles.length - 1); i++) {
    if (evaluateSetupAt(rule, candles, i).matched) out.push(i);
  }
  return out;
}
