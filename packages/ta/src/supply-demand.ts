import { atr, type Candle } from "./indicators.js";

/**
 * Supply and demand zones: the small "base" a market paused in just before a strong move away
 * (rally-base-rally / drop-base-rally for demand, the mirror for supply). They mark where one side
 * last overwhelmed the other. Each timeframe has its own: zones are always found from the candles
 * of the timeframe they belong to.
 *
 * Rules (fixed, so the same candles always give the same zones):
 *  - Strong move ("leg"): 1–3 candles in one direction whose combined move is at least
 *    LEG_ATR × ATR(14) and whose bodies are each at least half of their range.
 *  - Base: up to MAX_BASE quiet candles just before the leg (body at most half the range). With
 *    none, the single candle before the leg is the base (the "origin candle").
 *  - Demand box: proximal edge = highest body top of the base, distal edge = lowest low.
 *    Supply box: proximal = lowest body bottom, distal = highest high.
 *  - A box taller than MAX_HEIGHT_ATR × ATR is too vague to use and is skipped.
 *  - After the leg, each return into the box is a test. A close beyond the distal edge breaks the
 *    zone and it is dropped.
 *  - Overlapping zones on the same side keep the one with fewer tests (then the newer).
 * A zone is a record of where price reacted, not a forecast or a signal.
 */

export const SD_LEG_ATR = 2;
export const SD_MAX_BASE = 4;
export const SD_MAX_HEIGHT_ATR = 1.5;
export const SD_ATR_PERIOD = 14;

export interface SupplyDemandZone {
  side: "supply" | "demand";
  /** Box edges. For demand the proximal edge is the top; for supply it is the bottom. */
  top: number;
  bottom: number;
  proximal: number;
  distal: number;
  /** Open time (ms) of the first base candle: where the box starts on the chart. */
  t: number;
  /** Index of the first base candle, and of the first and last candles of the leg. */
  baseIndex: number;
  legStart: number;
  legEnd: number;
  /** How far the leg went, in ATRs (bigger = more forceful departure). */
  departureAtr: number;
  /** Returns into the box since it formed (0 = fresh). */
  tests: number;
}

const body = (c: Candle) => Math.abs(c.c - c.o);
const range = (c: Candle) => c.h - c.l;
const quiet = (c: Candle) => range(c) === 0 || body(c) <= range(c) * 0.5;
const strong = (c: Candle, dir: 1 | -1) =>
  range(c) > 0 && Math.sign(c.c - c.o) === dir && body(c) >= range(c) * 0.5;

/** Every zone's base and leg, as each formed (before any later test or break), oldest first. */
export function zoneCandidates(candles: readonly Candle[]): SupplyDemandZone[] {
  const a = atr(candles, SD_ATR_PERIOD);
  const found: SupplyDemandZone[] = [];
  const n = candles.length;
  for (let j = SD_ATR_PERIOD + 1; j < n; j++) {
    const ref = a[j - 1];
    if (!ref || ref <= 0) continue;
    for (const dir of [1, -1] as const) {
      const first = candles[j] as Candle;
      if (!strong(first, dir)) continue;
      // The previous candle must not already be part of the same move.
      if (strong(candles[j - 1] as Candle, dir)) continue;
      // Shortest leg of 1–3 strong candles that covers the distance.
      let end = -1;
      for (let k = j; k < Math.min(n, j + 3); k++) {
        if (!strong(candles[k] as Candle, dir)) break;
        if (dir * ((candles[k] as Candle).c - first.o) >= SD_LEG_ATR * ref) {
          end = k;
          break;
        }
      }
      if (end < 0) continue;
      // Base: quiet candles just before the leg, else the origin candle.
      let b = j;
      while (b - 1 >= 0 && j - (b - 1) <= SD_MAX_BASE && quiet(candles[b - 1] as Candle)) b--;
      if (b === j) b = j - 1;
      const base = candles.slice(b, j);
      const bodyTop = Math.max(...base.map((c) => Math.max(c.o, c.c)));
      const bodyBottom = Math.min(...base.map((c) => Math.min(c.o, c.c)));
      const zone =
        dir === 1
          ? { proximal: bodyTop, distal: Math.min(...base.map((c) => c.l)) }
          : { proximal: bodyBottom, distal: Math.max(...base.map((c) => c.h)) };
      const top = Math.max(zone.proximal, zone.distal);
      const bottom = Math.min(zone.proximal, zone.distal);
      if (top - bottom > SD_MAX_HEIGHT_ATR * ref || top <= bottom) continue;
      found.push({
        side: dir === 1 ? "demand" : "supply",
        top,
        bottom,
        ...zone,
        t: (candles[b] as Candle).t,
        baseIndex: b,
        legStart: j,
        legEnd: end,
        departureAtr: (dir * ((candles[end] as Candle).c - first.o)) / ref,
        tests: 0,
      });
    }
  }

  return found;
}

/**
 * Walks a zone over candles (from, to]: tests counted (a test is a return into the box after
 * being out of it), and whether a close went beyond the far edge.
 */
function walk(
  z: SupplyDemandZone,
  candles: readonly Candle[],
  to: number,
): { tests: number; broken: boolean } {
  let tests = 0;
  let inside = false;
  for (let i = z.legEnd + 1; i <= to; i++) {
    const c = candles[i] as Candle;
    const touches = z.side === "demand" ? c.l <= z.proximal : c.h >= z.proximal;
    if (touches && !inside) tests++;
    inside = touches;
    if (z.side === "demand" ? c.c < z.distal : c.c > z.distal) return { tests, broken: true };
  }
  return { tests, broken: false };
}

/** Every zone still standing at the last candle (broken ones are dropped), oldest first. */
export function supplyDemandZones(candles: readonly Candle[]): SupplyDemandZone[] {
  const n = candles.length;
  const alive: SupplyDemandZone[] = [];
  for (const z of zoneCandidates(candles)) {
    const w = walk(z, candles, n - 1);
    if (!w.broken) alive.push({ ...z, tests: w.tests });
  }

  // Overlaps on the same side: keep the fresher (then the newer).
  const kept: SupplyDemandZone[] = [];
  for (const z of alive) {
    const clash = kept.findIndex(
      (k) => k.side === z.side && z.bottom <= k.top && z.top >= k.bottom,
    );
    if (clash < 0) {
      kept.push(z);
      continue;
    }
    const k = kept[clash] as SupplyDemandZone;
    if (z.tests < k.tests || (z.tests === k.tests && z.t > k.t)) kept[clash] = z;
  }
  return kept.sort((x, y) => x.t - y.t);
}

/**
 * The zones that matter now: the nearest `perSide` supply zones at or above the price and demand
 * zones at or below it (a zone the price is inside counts as nearest).
 */
export function nearestZones(
  zones: readonly SupplyDemandZone[],
  price: number,
  perSide = 3,
): SupplyDemandZone[] {
  const dist = (z: SupplyDemandZone) =>
    price > z.top ? price - z.top : price < z.bottom ? z.bottom - price : 0;
  const pick = (side: SupplyDemandZone["side"]) =>
    zones
      .filter((z) => z.side === side && (side === "supply" ? z.top >= price : z.bottom <= price))
      .sort((x, y) => dist(x) - dist(y))
      .slice(0, perSide);
  return [...pick("supply"), ...pick("demand")];
}

/**
 * Whether the last candle taps a zone: it trades into a zone that formed earlier and was still
 * standing, and closes without breaking it (a demand candle closes at or above the bottom; a
 * supply candle at or below the top). With `freshOnly`, only a zone price had not come back to
 * before. Returns the zone (newest first when several), with its earlier tests, or null.
 * Sees only the candles given, so it never looks ahead.
 */
export function zoneTapAt(
  candles: readonly Candle[],
  side: SupplyDemandZone["side"],
  freshOnly: boolean,
): SupplyDemandZone | null {
  const j = candles.length - 1;
  const now = candles[j];
  if (!now) return null;
  const list = zoneCandidates(candles).filter((z) => z.side === side && z.legEnd < j);
  for (let x = list.length - 1; x >= 0; x--) {
    const z = list[x] as SupplyDemandZone;
    const taps =
      side === "demand"
        ? now.l <= z.proximal && now.c >= z.distal
        : now.h >= z.proximal && now.c <= z.distal;
    if (!taps) continue;
    const w = walk(z, candles, j - 1);
    if (w.broken || (freshOnly && w.tests > 0)) continue;
    return { ...z, tests: w.tests };
  }
  return null;
}
