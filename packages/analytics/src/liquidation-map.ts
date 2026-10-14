/**
 * Estimated liquidation map, the same family of model as CoinGlass-style heatmaps.
 *
 * No exchange publishes where traders' liquidation prices are, so this is an ESTIMATE built from
 * public data:
 *  1. When open interest (OI) rises in a candle, new positions were opened near that candle's
 *     typical price. The rise is split between longs and shorts by who was aggressive (the share of
 *     volume bought by takers).
 *  2. Each new position is spread over a typical leverage mix; its liquidation price follows from
 *     the leverage (long: price × (1 − 1/L + mm), short: price × (1 + 1/L − mm)).
 *  3. When price later trades through a level, those positions are treated as liquidated (removed).
 *  4. When OI falls, positions were closed: every remaining level shrinks in proportion.
 * OI from several exchanges is combined by adding each exchange's own changes.
 */

export interface MapCandle {
  /** Open time (ms). */
  t: number;
  h: number;
  l: number;
  c: number;
  /** Share of volume bought by takers, 0..1; null = unknown (split evenly). */
  takerBuyShare: number | null;
}

export interface MapOiPoint {
  t: number;
  /** Open interest in coins. */
  oi: number;
}

export interface LeverageTier {
  leverage: number;
  weight: number;
}

/** Typical retail futures leverage mix (assumption; weights sum to 1). */
export const DEFAULT_LEVERAGE_MIX: readonly LeverageTier[] = [
  { leverage: 10, weight: 0.3 },
  { leverage: 25, weight: 0.3 },
  { leverage: 50, weight: 0.25 },
  { leverage: 100, weight: 0.15 },
];
/** Maintenance margin rate used for liquidation prices. */
export const MAINTENANCE_MARGIN = 0.004;

export interface LiquidationCluster {
  side: "long" | "short";
  /** Centre of the price band. */
  price: number;
  /** Estimated position value (USD) that would be liquidated there. */
  usd: number;
}

export interface LiquidationMap {
  /** Time of the first column (ms) and column length (ms). */
  start: number;
  bucketMs: number;
  /** Number of time columns. */
  count: number;
  priceMin: number;
  priceMax: number;
  /** Number of price rows, bottom (priceMin) to top. */
  bins: number;
  /**
   * Intensity per cell, row-major by time then price bin (count × bins), 0..255 on a square-root
   * scale: usd ≈ maxCellUsd × (q / 255)².
   */
  cells: Uint8Array;
  maxCellUsd: number;
  /** Largest remaining clusters now: longs below the price, shorts above. */
  clusters: LiquidationCluster[];
  /** Total estimated value still at risk now (USD). */
  totalLongUsd: number;
  totalShortUsd: number;
}

export interface LiquidationMapInput {
  candles: readonly MapCandle[];
  /** OI series per source (exchange). Each series is used for its own changes only. */
  oi: Readonly<Record<string, readonly MapOiPoint[]>>;
  bucketMs: number;
  bins?: number;
  leverageMix?: readonly LeverageTier[];
  maintenanceMargin?: number;
}

/** OI change per candle, summed over sources; also total OI per candle (for proportional closes). */
export function combineOi(
  candles: readonly MapCandle[],
  oi: Readonly<Record<string, readonly MapOiPoint[]>>,
  bucketMs: number,
): { delta: number[]; total: number[] } {
  const n = candles.length;
  const delta = new Array<number>(n).fill(0);
  const total = new Array<number>(n).fill(0);
  if (n === 0) return { delta, total };
  const start = (candles[0] as MapCandle).t;
  for (const series of Object.values(oi)) {
    // Last reading inside each candle.
    const byBucket = new Map<number, number>();
    for (const p of series) {
      const i = Math.floor((p.t - start) / bucketMs);
      if (i >= 0 && i < n && Number.isFinite(p.oi)) byBucket.set(i, p.oi);
    }
    let last: number | null = null;
    for (let i = 0; i < n; i++) {
      const v = byBucket.get(i);
      if (v !== undefined) {
        if (last !== null) delta[i] = (delta[i] as number) + (v - last);
        last = v;
      }
      if (last !== null) total[i] = (total[i] as number) + last;
    }
  }
  return { delta, total };
}

export function buildLiquidationMap(input: LiquidationMapInput): LiquidationMap | null {
  const { candles, bucketMs } = input;
  const bins = input.bins ?? 160;
  const mix = input.leverageMix ?? DEFAULT_LEVERAGE_MIX;
  const mm = input.maintenanceMargin ?? MAINTENANCE_MARGIN;
  const n = candles.length;
  if (n < 2) return null;

  const minLev = Math.min(...mix.map((m) => m.leverage));
  const reach = 1 / minLev + 0.01;
  const lows = candles.map((c) => c.l);
  const highs = candles.map((c) => c.h);
  const priceMin = Math.min(...lows) * (1 - reach);
  const priceMax = Math.max(...highs) * (1 + reach);
  if (!(priceMin > 0) || !(priceMax > priceMin)) return null;
  const binSize = (priceMax - priceMin) / bins;
  const binOf = (p: number) =>
    Math.min(bins - 1, Math.max(0, Math.floor((p - priceMin) / binSize)));
  const centre = (b: number) => priceMin + (b + 0.5) * binSize;

  const { delta, total } = combineOi(candles, input.oi, bucketMs);
  const long = new Float64Array(bins);
  const short = new Float64Array(bins);
  const grid = new Float64Array(n * bins);
  let maxCell = 0;

  for (let i = 0; i < n; i++) {
    const c = candles[i] as MapCandle;
    // 1. Price trading through a level liquidates it.
    for (let b = 0; b < bins; b++) {
      const p = centre(b);
      if (p >= c.l) long[b] = 0;
      if (p <= c.h) short[b] = 0;
    }
    // 2. Positions opened or closed in this candle.
    const d = delta[i] as number;
    const typical = (c.h + c.l + c.c) / 3;
    if (d > 0) {
      const usd = d * typical;
      const share = c.takerBuyShare ?? 0.5;
      for (const { leverage, weight } of mix) {
        const longPrice = typical * (1 - 1 / leverage + mm);
        const shortPrice = typical * (1 + 1 / leverage - mm);
        // Levels already beyond this candle's range would have been hit at once.
        const lb = binOf(longPrice);
        const sb = binOf(shortPrice);
        if (longPrice < c.l) long[lb] = (long[lb] as number) + usd * share * weight;
        if (shortPrice > c.h) short[sb] = (short[sb] as number) + usd * (1 - share) * weight;
      }
    } else if (d < 0) {
      const prev = i > 0 ? (total[i - 1] as number) : 0;
      const f = prev > 0 ? Math.max(0, 1 + d / prev) : 1;
      for (let b = 0; b < bins; b++) {
        long[b] = (long[b] as number) * f;
        short[b] = (short[b] as number) * f;
      }
    }
    // 3. Snapshot for this column.
    for (let b = 0; b < bins; b++) {
      const v = (long[b] as number) + (short[b] as number);
      grid[i * bins + b] = v;
      if (v > maxCell) maxCell = v;
    }
  }

  const cells = new Uint8Array(n * bins);
  if (maxCell > 0) {
    for (let k = 0; k < grid.length; k++) {
      cells[k] = Math.round(255 * Math.sqrt((grid[k] as number) / maxCell));
    }
  }

  const last = candles[n - 1] as MapCandle;
  return {
    start: (candles[0] as MapCandle).t,
    bucketMs,
    count: n,
    priceMin,
    priceMax,
    bins,
    cells,
    maxCellUsd: maxCell,
    clusters: [
      ...topClusters(long, centre, "long", (p) => p < last.c),
      ...topClusters(short, centre, "short", (p) => p > last.c),
    ],
    totalLongUsd: long.reduce((a, b) => a + b, 0),
    totalShortUsd: short.reduce((a, b) => a + b, 0),
  };
}

/** The biggest bands (each bin plus its neighbours), at least 3 bins apart. */
function topClusters(
  side: Float64Array,
  centre: (b: number) => number,
  name: "long" | "short",
  keep: (price: number) => boolean,
  max = 4,
): LiquidationCluster[] {
  const bands = Array.from(side, (_, b) => ({
    b,
    usd: (side[b - 1] ?? 0) + (side[b] as number) + (side[b + 1] ?? 0),
  })).filter((x) => x.usd > 0 && keep(centre(x.b)));
  bands.sort((a, b) => b.usd - a.usd);
  const picked: typeof bands = [];
  for (const x of bands) {
    if (picked.length >= max) break;
    if (picked.every((p) => Math.abs(p.b - x.b) >= 3)) picked.push(x);
  }
  return picked.map((x) => ({ side: name, price: centre(x.b), usd: x.usd }));
}
