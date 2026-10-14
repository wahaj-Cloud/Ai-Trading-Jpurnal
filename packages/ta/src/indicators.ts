/**
 * Technical indicators over candles. Prices here are market data (not money owed), so plain
 * floating point is appropriate; results are rounded only for display.
 */
export interface Candle {
  /** Open time, ms since epoch (UTC). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Exponential moving average; null until `period` values exist (seeded with the simple average). */
export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] as number) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Relative Strength Index with Wilder's smoothing. */
export function rsi(closes: readonly number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = (closes[i] as number) - (closes[i - 1] as number);
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = (closes[i] as number) - (closes[i - 1] as number);
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** Average True Range (Wilder). */
export function atr(candles: readonly Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) => {
    const prev = candles[i - 1];
    return prev ? Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c)) : c.h - c.l;
  });
  let value = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < candles.length; i++) {
    value = (value * (period - 1) + (tr[i] as number)) / period;
    out[i] = value;
  }
  return out;
}

/** Volume-weighted average price, re-anchored at the start of each UTC day (the usual session VWAP). */
export function sessionVwap(candles: readonly Candle[]): number[] {
  const out: number[] = [];
  let day = -1;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const d = Math.floor(c.t / 86_400_000);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * c.v;
    vol += c.v;
    out.push(vol > 0 ? pv / vol : typical);
  }
  return out;
}

/** Bollinger Bands: `period` simple average ± `mult` population standard deviations. */
export function bollinger(
  closes: readonly number[],
  period = 20,
  mult = 2,
): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i] as number;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += ((closes[j] as number) - m) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

/** MACD line (fast EMA − slow EMA), its signal EMA, and the histogram (MACD − signal). */
export function macd(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => {
    const a = f[i];
    const b = s[i];
    return a === null || a === undefined || b === null || b === undefined ? null : a - b;
  });
  const start = line.findIndex((v) => v !== null);
  const sig: (number | null)[] = new Array(closes.length).fill(null);
  if (start >= 0) {
    const tail = ema(line.slice(start) as number[], signal);
    tail.forEach((v, i) => {
      sig[start + i] = v;
    });
  }
  const hist = line.map((v, i) => {
    const g = sig[i];
    return v === null || g === null || g === undefined ? null : v - g;
  });
  return { macd: line, signal: sig, hist };
}

/** Heikin Ashi candles: smoothed bodies that make trends easier to read. */
export function heikinAshi(candles: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const [i, c] of candles.entries()) {
    const close = (c.o + c.h + c.l + c.c) / 4;
    const prev = out[i - 1];
    const open = prev ? (prev.o + prev.c) / 2 : (c.o + c.c) / 2;
    out.push({
      t: c.t,
      o: open,
      h: Math.max(c.h, open, close),
      l: Math.min(c.l, open, close),
      c: close,
      v: c.v,
    });
  }
  return out;
}
