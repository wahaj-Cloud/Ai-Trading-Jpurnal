import {
  type GaugeDto,
  type IndicatorReading,
  moodOf,
  type RatingDto,
  type RatingTf,
  ratingLevel,
  type Signal,
} from "@atc/shared";
import { type Candle, ema, macd, rsi, sma } from "./indicators.js";

/**
 * Technical ratings by the published TradingView rules (11 oscillators, 15 moving averages), and
 * ADX for the market mood. Every series is computed over the whole candle list; the rating reads
 * the newest candle (and the one before it for "rising" / "falling").
 *
 * Conventions where the published rules leave a choice:
 *  - "Uptrend" for Stochastic RSI and Bull Bear Power: close above its 50-period EMA.
 *  - Ichimoku leading spans are compared as plotted at the current candle (computed 25 candles
 *    earlier, the standard 26-period displacement).
 *  - CCI uses the typical price (high + low + close) / 3.
 */

type S = (number | null)[];
const at = (s: S, i: number) => (i >= 0 && i < s.length ? (s[i] ?? null) : null);

/** Wilder's moving average (RMA), seeded with the simple average of the first `n` values. */
export function rma(values: readonly (number | null)[], n: number): S {
  const out: S = new Array(values.length).fill(null);
  let seed: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    if (prev === null) {
      seed.push(v);
      if (seed.length === n) {
        prev = seed.reduce((a, b) => a + b, 0) / n;
        out[i] = prev;
        seed = [];
      }
      continue;
    }
    prev = (prev * (n - 1) + v) / n;
    out[i] = prev;
  }
  return out;
}

export function wma(values: readonly (number | null)[], n: number): S {
  const out: S = new Array(values.length).fill(null);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const v = values[i - k];
      if (v === null || v === undefined) {
        ok = false;
        break;
      }
      sum += v * (n - k);
    }
    if (ok) out[i] = sum / denom;
  }
  return out;
}

const smaN = (values: readonly (number | null)[], n: number): S => {
  const out: S = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const v = values[i - k];
      if (v === null || v === undefined) {
        ok = false;
        break;
      }
      sum += v;
    }
    if (ok) out[i] = sum / n;
  }
  return out;
};

const highest = (c: readonly Candle[], n: number, i: number) => {
  if (i < n - 1) return null;
  let m = Number.NEGATIVE_INFINITY;
  for (let k = i - n + 1; k <= i; k++) m = Math.max(m, (c[k] as Candle).h);
  return m;
};
const lowest = (c: readonly Candle[], n: number, i: number) => {
  if (i < n - 1) return null;
  let m = Number.POSITIVE_INFINITY;
  for (let k = i - n + 1; k <= i; k++) m = Math.min(m, (c[k] as Candle).l);
  return m;
};

/** Hull moving average: WMA(2·WMA(n/2) − WMA(n), √n). */
export function hma(closes: readonly number[], n: number): S {
  const half = wma(closes, Math.floor(n / 2));
  const full = wma(closes, n);
  const diff = closes.map((_, i) => {
    const a = half[i];
    const b = full[i];
    return a === null || a === undefined || b === null || b === undefined ? null : 2 * a - b;
  });
  return wma(diff, Math.floor(Math.sqrt(n)));
}

export function vwma(c: readonly Candle[], n: number): S {
  return c.map((_, i) => {
    if (i < n - 1) return null;
    let pv = 0;
    let v = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const x = c[k] as Candle;
      pv += x.c * x.v;
      v += x.v;
    }
    return v > 0 ? pv / v : null;
  });
}

/** Stochastic %K (smoothed) and %D. */
export function stochastic(c: readonly Candle[], n = 14, smoothK = 3, smoothD = 3) {
  const raw: S = c.map((x, i) => {
    const hh = highest(c, n, i);
    const ll = lowest(c, n, i);
    if (hh === null || ll === null) return null;
    return hh === ll ? 50 : (100 * (x.c - ll)) / (hh - ll);
  });
  const k = smaN(raw, smoothK);
  return { k, d: smaN(k, smoothD) };
}

/** Stochastic RSI (3, 3, 14, 14): stochastic of RSI, K smoothed by 3, D by 3. */
export function stochRsi(
  closes: readonly number[],
  kLen = 3,
  dLen = 3,
  rsiLen = 14,
  stochLen = 14,
) {
  const r = rsi(closes, rsiLen);
  const raw: S = r.map((v, i) => {
    if (v === null || i < stochLen - 1) return null;
    let hh = Number.NEGATIVE_INFINITY;
    let ll = Number.POSITIVE_INFINITY;
    for (let k = i - stochLen + 1; k <= i; k++) {
      const x = r[k];
      if (x === null || x === undefined) return null;
      hh = Math.max(hh, x);
      ll = Math.min(ll, x);
    }
    return hh === ll ? 50 : (100 * (v - ll)) / (hh - ll);
  });
  const k = smaN(raw, kLen);
  return { k, d: smaN(k, dLen) };
}

export function cci(c: readonly Candle[], n = 20): S {
  const tp = c.map((x) => (x.h + x.l + x.c) / 3);
  const m = sma(tp, n);
  return tp.map((v, i) => {
    const mean = m[i];
    if (mean === null || mean === undefined) return null;
    let dev = 0;
    for (let k = i - n + 1; k <= i; k++) dev += Math.abs((tp[k] as number) - mean);
    dev /= n;
    return dev === 0 ? 0 : (v - mean) / (0.015 * dev);
  });
}

/** ADX with +DI / −DI (Wilder smoothing). */
export function adx(c: readonly Candle[], diLen = 14, adxLen = 14) {
  const plusDm: S = [null];
  const minusDm: S = [null];
  const tr: S = [null];
  for (let i = 1; i < c.length; i++) {
    const x = c[i] as Candle;
    const p = c[i - 1] as Candle;
    const up = x.h - p.h;
    const down = p.l - x.l;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(x.h - x.l, Math.abs(x.h - p.c), Math.abs(x.l - p.c)));
  }
  const trS = rma(tr, diLen);
  const pS = rma(plusDm, diLen);
  const mS = rma(minusDm, diLen);
  const plus: S = c.map((_, i) => {
    const t = trS[i];
    const v = pS[i];
    return t && v !== null && v !== undefined ? (100 * v) / t : null;
  });
  const minus: S = c.map((_, i) => {
    const t = trS[i];
    const v = mS[i];
    return t && v !== null && v !== undefined ? (100 * v) / t : null;
  });
  const dx: S = c.map((_, i) => {
    const a = plus[i];
    const b = minus[i];
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return a + b === 0 ? 0 : (100 * Math.abs(a - b)) / (a + b);
  });
  return { adx: rma(dx, adxLen), plus, minus };
}

export function awesome(c: readonly Candle[]): S {
  const hl2 = c.map((x) => (x.h + x.l) / 2);
  const f = sma(hl2, 5);
  const s = sma(hl2, 34);
  return hl2.map((_, i) => {
    const a = f[i];
    const b = s[i];
    return a === null || a === undefined || b === null || b === undefined ? null : a - b;
  });
}

export function williamsR(c: readonly Candle[], n = 14): S {
  return c.map((x, i) => {
    const hh = highest(c, n, i);
    const ll = lowest(c, n, i);
    if (hh === null || ll === null) return null;
    return hh === ll ? -50 : (-100 * (hh - x.c)) / (hh - ll);
  });
}

export function ultimate(c: readonly Candle[], a = 7, b = 14, d = 28): S {
  const bp: S = [null];
  const tr: S = [null];
  for (let i = 1; i < c.length; i++) {
    const x = c[i] as Candle;
    const pc = (c[i - 1] as Candle).c;
    const lo = Math.min(x.l, pc);
    bp.push(x.c - lo);
    tr.push(Math.max(x.h, pc) - lo);
  }
  const avg = (i: number, n: number) => {
    if (i < n) return null;
    let s1 = 0;
    let s2 = 0;
    for (let k = i - n + 1; k <= i; k++) {
      s1 += bp[k] as number;
      s2 += tr[k] as number;
    }
    return s2 === 0 ? null : s1 / s2;
  };
  return c.map((_, i) => {
    const x = avg(i, a);
    const y = avg(i, b);
    const z = avg(i, d);
    return x === null || y === null || z === null ? null : (100 * (4 * x + 2 * y + z)) / 7;
  });
}

const gauge = (items: IndicatorReading[]): GaugeDto => {
  const counted = items.filter((x) => x.value !== null);
  const up = counted.filter((x) => x.signal === 1).length;
  const down = counted.filter((x) => x.signal === -1).length;
  const neutral = counted.length - up - down;
  const score = counted.length ? (up - down) / counted.length : 0;
  return { score, level: ratingLevel(score), up, down, neutral, items };
};
const r4 = (v: number | null) => (v === null ? null : Number(v.toPrecision(6)));
const sig = (buy: boolean, sell: boolean): Signal => (buy ? 1 : sell ? -1 : 0);

/** Ratings for the newest candle. Needs about 250 candles for every indicator to be ready. */
export function technicalRatings(c: readonly Candle[], tf: RatingTf, now = Date.now()): RatingDto {
  const i = c.length - 1;
  const closes = c.map((x) => x.c);
  const close = closes[i] ?? Number.NaN;
  const trendEma = at(ema(closes, 50), i);
  const uptrend = trendEma !== null && close > trendEma;
  const downtrend = trendEma !== null && close < trendEma;

  // ── Oscillators ──
  const osc: IndicatorReading[] = [];
  const rs = rsi(closes, 14);
  {
    const v = at(rs, i);
    const p = at(rs, i - 1);
    osc.push({
      name: "RSI (14)",
      value: r4(v),
      signal: v === null || p === null ? 0 : sig(v < 30 && v > p, v > 70 && v < p),
    });
  }
  {
    const { k, d } = stochastic(c, 14, 3, 3);
    const kv = at(k, i);
    const dv = at(d, i);
    osc.push({
      name: "Stochastic %K (14, 3, 3)",
      value: r4(kv),
      signal:
        kv === null || dv === null
          ? 0
          : sig(kv < 20 && dv < 20 && kv > dv, kv > 80 && dv > 80 && kv < dv),
    });
  }
  {
    const s = cci(c, 20);
    const v = at(s, i);
    const p = at(s, i - 1);
    osc.push({
      name: "CCI (20)",
      value: r4(v),
      signal: v === null || p === null ? 0 : sig(v < -100 && v > p, v > 100 && v < p),
    });
  }
  const dmi = adx(c, 14, 14);
  const adxV = at(dmi.adx, i);
  const plusV = at(dmi.plus, i);
  const minusV = at(dmi.minus, i);
  {
    const p = at(dmi.adx, i - 1);
    osc.push({
      name: "ADX (14)",
      value: r4(adxV),
      signal:
        adxV === null || p === null || plusV === null || minusV === null
          ? 0
          : sig(plusV > minusV && adxV > 20 && adxV > p, plusV < minusV && adxV > 20 && adxV < p),
    });
  }
  {
    const ao = awesome(c);
    const v = at(ao, i);
    const p1 = at(ao, i - 1);
    const p2 = at(ao, i - 2);
    const ok = v !== null && p1 !== null && p2 !== null;
    osc.push({
      name: "Awesome Oscillator",
      value: r4(v),
      signal: !ok
        ? 0
        : sig(
            (p1 <= 0 && v > 0) || (v > 0 && p1 > 0 && v > p1 && p2 > p1),
            (p1 >= 0 && v < 0) || (v < 0 && p1 < 0 && v < p1 && p2 < p1),
          ),
    });
  }
  {
    const m = (j: number) =>
      j >= 10 && j < closes.length ? (closes[j] as number) - (closes[j - 10] as number) : null;
    const v = m(i);
    const p = m(i - 1);
    osc.push({
      name: "Momentum (10)",
      value: r4(v),
      signal: v === null || p === null ? 0 : sig(v > p, v < p),
    });
  }
  {
    const md = macd(closes, 12, 26, 9);
    const v = at(md.macd, i);
    const s = at(md.signal, i);
    osc.push({
      name: "MACD (12, 26)",
      value: r4(v),
      signal: v === null || s === null ? 0 : sig(v > s, v < s),
    });
  }
  {
    const { k, d } = stochRsi(closes);
    const kv = at(k, i);
    const dv = at(d, i);
    osc.push({
      name: "Stochastic RSI (3, 3, 14, 14)",
      value: r4(kv),
      signal:
        kv === null || dv === null
          ? 0
          : sig(
              downtrend && kv < 20 && dv < 20 && kv > dv,
              uptrend && kv > 80 && dv > 80 && kv < dv,
            ),
    });
  }
  {
    const w = williamsR(c, 14);
    const v = at(w, i);
    const p = at(w, i - 1);
    osc.push({
      name: "Williams %R (14)",
      value: r4(v),
      signal: v === null || p === null ? 0 : sig(v < -80 && v > p, v > -20 && v < p),
    });
  }
  {
    const e = ema(closes, 13);
    const bull = (j: number) => {
      const x = at(e, j);
      return x === null ? null : (c[j] as Candle).h - x;
    };
    const bear = (j: number) => {
      const x = at(e, j);
      return x === null ? null : (c[j] as Candle).l - x;
    };
    const bu = bull(i);
    const be = bear(i);
    const bup = bull(i - 1);
    const bep = bear(i - 1);
    osc.push({
      name: "Bull Bear Power (13)",
      value: bu === null || be === null ? null : r4(bu + be),
      signal:
        bu === null || be === null || bup === null || bep === null
          ? 0
          : sig(uptrend && be < 0 && be > bep, downtrend && bu > 0 && bu < bup),
    });
  }
  {
    const u = ultimate(c);
    const v = at(u, i);
    osc.push({
      name: "Ultimate Oscillator (7, 14, 28)",
      value: r4(v),
      signal: v === null ? 0 : sig(v > 70, v < 30),
    });
  }

  // ── Moving averages ──
  const mas: IndicatorReading[] = [];
  for (const n of [10, 20, 30, 50, 100, 200]) {
    for (const [kind, s] of [
      ["EMA", ema(closes, n)],
      ["SMA", sma(closes, n)],
    ] as const) {
      const v = at(s, i);
      mas.push({
        name: `${kind} (${n})`,
        value: r4(v),
        signal: v === null ? 0 : sig(v < close, v > close),
      });
    }
  }
  {
    const v = at(hma(closes, 9), i);
    mas.push({
      name: "Hull MA (9)",
      value: r4(v),
      signal: v === null ? 0 : sig(v < close, v > close),
    });
  }
  {
    const v = at(vwma(c, 20), i);
    mas.push({
      name: "VWMA (20)",
      value: r4(v),
      signal: v === null ? 0 : sig(v < close, v > close),
    });
  }
  {
    const donchian = (n: number, j: number) => {
      const h = highest(c, n, j);
      const l = lowest(c, n, j);
      return h === null || l === null ? null : (h + l) / 2;
    };
    const conv = donchian(9, i);
    const base = donchian(26, i);
    const j = i - 25; // leading spans plotted at this candle were computed 25 candles earlier
    const c9 = donchian(9, j);
    const b26 = donchian(26, j);
    const spanA = c9 === null || b26 === null ? null : (c9 + b26) / 2;
    const spanB = donchian(52, j);
    const ok = conv !== null && base !== null && spanA !== null && spanB !== null;
    mas.push({
      name: "Ichimoku base line (9, 26, 52)",
      value: r4(base),
      signal: !ok
        ? 0
        : sig(
            spanA > spanB && base > spanA && conv > base && close > conv,
            spanA < spanB && base < spanA && conv < base && close < conv,
          ),
    });
  }

  const oscillators = gauge(osc);
  const movingAverages = gauge(mas);
  const counted =
    oscillators.up + oscillators.down + oscillators.neutral > 0 &&
    movingAverages.up + movingAverages.down + movingAverages.neutral > 0;
  const score = counted ? (oscillators.score + movingAverages.score) / 2 : 0;
  return {
    tf,
    lastCandle: (c[i] as Candle | undefined)?.t ?? 0,
    computedAt: new Date(now).toISOString(),
    summary: {
      score,
      level: ratingLevel(score),
      up: oscillators.up + movingAverages.up,
      down: oscillators.down + movingAverages.down,
      neutral: oscillators.neutral + movingAverages.neutral,
      items: [],
    },
    oscillators,
    movingAverages,
    adx: r4(adxV),
    plusDi: r4(plusV),
    minusDi: r4(minusV),
    mood: adxV === null || plusV === null || minusV === null ? null : moodOf(adxV, plusV, minusV),
  };
}
