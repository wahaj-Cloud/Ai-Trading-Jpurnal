/**
 * Pure maths for the chart overlays (drawings, countdown): no chart or browser objects, so it is
 * unit-tested directly.
 */

/** A point on the chart: time in UNIX seconds (may fall between or beyond candles) and a price. */
export interface ChartPoint {
  t: number;
  p: number;
}

/**
 * Converts times to fractional candle positions ("logical" indexes) and back. Times between two
 * candles land between them; times before the first or after the last candle are extrapolated by
 * the timeframe, so drawings can extend into the future like on TradingView.
 */
export class TimeAxis {
  constructor(
    private readonly times: readonly number[],
    private readonly step: number,
  ) {}

  get length(): number {
    return this.times.length;
  }

  toLogical(t: number): number {
    const ts = this.times;
    const n = ts.length;
    if (n === 0) return 0;
    const first = ts[0] as number;
    const last = ts[n - 1] as number;
    if (t <= first) return (t - first) / this.step;
    if (t >= last) return n - 1 + (t - last) / this.step;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((ts[mid] as number) <= t) lo = mid;
      else hi = mid;
    }
    const a = ts[lo] as number;
    const b = ts[hi] as number;
    return lo + (t - a) / (b - a);
  }

  toTime(logical: number): number {
    const ts = this.times;
    const n = ts.length;
    if (n === 0) return 0;
    const first = ts[0] as number;
    const last = ts[n - 1] as number;
    if (logical <= 0) return first + logical * this.step;
    if (logical >= n - 1) return last + (logical - (n - 1)) * this.step;
    const i = Math.floor(logical);
    const a = ts[i] as number;
    const b = ts[i + 1] as number;
    return a + (logical - i) * (b - a);
  }
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

/** Where the ray from a through b leaves a box of the given size (or b itself if a === b). */
export function rayEnd(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return { x: bx, y: by };
  const ts: number[] = [];
  if (dx > 0) ts.push((width - ax) / dx);
  if (dx < 0) ts.push(-ax / dx);
  if (dy > 0) ts.push((height - ay) / dy);
  if (dy < 0) ts.push(-ay / dy);
  const t = Math.max(1, Math.min(...ts.filter((v) => v > 0)));
  return { x: ax + dx * t, y: ay + dy * t };
}

/** Fibonacci retracement levels, TradingView's defaults. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Price at each Fibonacci level, measured from b (level 0) back to a (level 1). */
export function fibPrices(a: number, b: number): Array<{ level: number; price: number }> {
  return FIB_LEVELS.map((level) => ({ level, price: b + (a - b) * level }));
}

/** Time left until a candle closes, e.g. "42", "03:12", "1:03:12", "2d 05h". */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (v: number) => String(v).padStart(2, "0");
  if (d > 0) return `${d}d ${two(h)}h`;
  if (h > 0) return `${h}:${two(m)}:${two(s)}`;
  return `${two(m)}:${two(s)}`;
}
