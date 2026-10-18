import type { BiasState, BiasTimeframe, TimeframeBiasDto } from "@atc/shared";
import { atr, type Candle, ema } from "./indicators.js";
import { marketStructure } from "./structure.js";

/**
 * Trend bias of one timeframe, from closed candles only. Three measured votes:
 *  1. close above / below the 50 EMA;
 *  2. 50 EMA above / below the 200 EMA (left out while there is not enough history);
 *  3. direction of the last break of swing structure (close beyond the latest swing high or low).
 * Two votes the same way set the trend; anything else is a range. A price or average within a
 * quarter of an average candle range (ATR 14) of the other counts as no vote, so a flat market
 * with tiny wiggles reads as a range instead of flipping on noise.
 */

const fmt = (v: number) =>
  v.toLocaleString("en", { maximumFractionDigits: v >= 1000 ? 1 : v >= 1 ? 3 : 6 });

const NEAR = 0.25;

function stateAt(
  i: number,
  closes: readonly number[],
  e50: readonly (number | null)[],
  e200: readonly (number | null)[],
  range: readonly (number | null)[],
  structure: "UP" | "DOWN" | "RANGE",
): { state: BiasState; votes: number[] } {
  const votes: number[] = [];
  const c = closes[i] as number;
  const a = e50[i];
  const b = e200[i];
  const band = NEAR * (range[i] ?? 0);
  const vote = (x: number, y: number) => (x - y > band ? 1 : y - x > band ? -1 : 0);
  if (a !== null && a !== undefined) votes.push(vote(c, a));
  if (a !== null && a !== undefined && b !== null && b !== undefined) votes.push(vote(a, b));
  votes.push(structure === "UP" ? 1 : structure === "DOWN" ? -1 : 0);
  const ups = votes.filter((v) => v > 0).length;
  const downs = votes.filter((v) => v < 0).length;
  return { state: ups >= 2 ? "up" : downs >= 2 ? "down" : "range", votes };
}

/** Needs at least 60 closed candles; returns null otherwise. */
export function timeframeBias(
  candles: readonly Candle[],
  timeframe: BiasTimeframe,
): TimeframeBiasDto | null {
  const n = candles.length;
  if (n < 60) return null;
  const closes = candles.map((c) => c.c);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const range = atr(candles, 14);
  const now = marketStructure(candles);
  const current = stateAt(n - 1, closes, e50, e200, range, now.trend);

  // How long the current state has held, checked bar by bar (up to 99 bars back).
  let bars = 1;
  for (let i = n - 2; i >= Math.max(0, n - 99); i--) {
    const s = stateAt(i, closes, e50, e200, range, marketStructure(candles, i + 1).trend);
    if (s.state !== current.state) break;
    bars++;
  }

  const close = closes[n - 1] as number;
  const a = e50[n - 1];
  const b = e200[n - 1];
  const band = NEAR * (range[n - 1] ?? 0);
  const where = (x: number, y: number) =>
    Math.abs(x - y) <= band ? "near" : x > y ? "above" : "below";
  const evidence: string[] = [];
  if (a !== null && a !== undefined)
    evidence.push(`Close ${fmt(close)} ${where(close, a)} the 50 EMA (${fmt(a)}).`);
  if (a !== null && a !== undefined && b !== null && b !== undefined)
    evidence.push(`50 EMA ${where(a, b)} the 200 EMA (${fmt(b)}).`);
  else evidence.push("Not enough history yet for the 200 EMA.");
  const lastBreak = now.events.at(-1);
  evidence.push(
    lastBreak
      ? `Last structure break: ${lastBreak.direction === "UP" ? "up, close above the swing high" : "down, close below the swing low"} at ${fmt(lastBreak.level)}.`
      : "No structure break yet in this history.",
  );
  return { timeframe, state: current.state, bars, evidence };
}

/**
 * Four-hour candles from closed one-hour candles (UTC 00/04/08/12/16/20 blocks), keeping only
 * complete blocks so the 4h bias never reads a candle that is still forming.
 */
export function closedFourHour(c1h: readonly Candle[]): Candle[] {
  const H = 3_600_000;
  const out: Candle[] = [];
  let count = 0;
  for (const c of c1h) {
    const t = Math.floor(c.t / (4 * H)) * 4 * H;
    const last = out.at(-1);
    if (last && last.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
      count++;
    } else {
      if (last && count < 4) out.pop(); // an incomplete block (gap or start of history)
      out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
      count = 1;
    }
  }
  if (out.length && count < 4) out.pop();
  return out;
}

/**
 * The bias state after every closed candle from `from` on, for matching past trades with the trend
 * they were entered in. `at` is the candle's close time (open + period). Each state equals what
 * timeframeBias would have said with only the candles up to that one, so history never peeks ahead.
 */
export function biasHistory(
  candles: readonly Candle[],
  periodMs: number,
  from = 250,
): Array<{ at: number; state: BiasState }> {
  const n = candles.length;
  if (n < 60) return [];
  const closes = candles.map((c) => c.c);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const range = atr(candles, 14);
  const out: Array<{ at: number; state: BiasState }> = [];
  for (let i = Math.max(59, from); i < n; i++) {
    const s = stateAt(i, closes, e50, e200, range, marketStructure(candles, i + 1).trend);
    out.push({ at: (candles[i] as Candle).t + periodMs, state: s.state });
  }
  return out;
}
