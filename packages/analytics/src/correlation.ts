/**
 * Correlation and beta of a coin to BTC from close prices. Market data, so plain floating point.
 * Returns are log returns over aligned candle times (both series must have the candle).
 */

export interface ClosePoint {
  /** Candle open time, ms. */
  t: number;
  c: number;
}

export interface CorrelationResult {
  corr: number;
  beta: number;
  /** Simple return over the aligned window (0.05 = +5%). */
  coinReturn: number;
  btcReturn: number;
  /** Aligned candles used. */
  points: number;
}

/** Pearson correlation of two equal-length series; null when either does not move. */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i] as number;
    my += y[i] as number;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Beta of `y` (coin) against `x` (BTC): cov(x, y) / var(x). */
export function beta(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    cov += dx * ((y[i] as number) - my);
    varx += dx * dx;
  }
  return varx === 0 ? null : cov / varx;
}

/**
 * Coin vs BTC over one window. Null when fewer than `minCoverage` of the expected candles line up
 * (a new or halted listing), so a thin sample never shows as a confident number.
 */
export function correlateToBtc(
  coin: readonly ClosePoint[],
  btc: readonly ClosePoint[],
  expectedPoints: number,
  minCoverage = 0.8,
): CorrelationResult | null {
  const btcAt = new Map(btc.map((p) => [p.t, p.c]));
  const aligned = coin
    .filter((p) => btcAt.has(p.t) && p.c > 0 && (btcAt.get(p.t) as number) > 0)
    .sort((a, b) => a.t - b.t);
  if (aligned.length < Math.max(3, Math.ceil(expectedPoints * minCoverage))) return null;
  const cr: number[] = [];
  const br: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const a = aligned[i - 1] as ClosePoint;
    const b = aligned[i] as ClosePoint;
    cr.push(Math.log(b.c / a.c));
    br.push(Math.log((btcAt.get(b.t) as number) / (btcAt.get(a.t) as number)));
  }
  const corr = pearson(br, cr);
  const b = beta(br, cr);
  if (corr === null || b === null) return null;
  const first = aligned[0] as ClosePoint;
  const last = aligned.at(-1) as ClosePoint;
  return {
    corr: Number(corr.toFixed(4)),
    beta: Number(b.toFixed(4)),
    coinReturn: Number((last.c / first.c - 1).toFixed(6)),
    btcReturn: Number(
      ((btcAt.get(last.t) as number) / (btcAt.get(first.t) as number) - 1).toFixed(6),
    ),
    points: aligned.length,
  };
}
