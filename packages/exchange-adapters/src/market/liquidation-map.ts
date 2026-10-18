import { buildLiquidationMap, type MapOiPoint } from "@atc/analytics";
import {
  LIQ_MAP_SOURCES,
  LIQ_MAP_WINDOW_SPEC,
  type LiqMapSource,
  type LiqMapWindow,
  type LiquidationMapDto,
} from "@atc/shared";
import type { AdapterConfig } from "../registry.js";
import {
  fetchBinanceFlowCandles,
  fetchBinanceOpenInterest,
  fetchBybitOpenInterest,
  fetchOkxOpenInterest,
} from "./open-interest.js";

/**
 * The estimated liquidation map for one market: public open interest from every exchange that lists
 * it, Binance candles with taker flow, and the model in @atc/analytics. Shared by the worker (every
 * 5 minutes) and the API (on demand, when no recent map exists).
 */

export type LiquidationMapData = Omit<LiquidationMapDto, "symbol" | "window" | "computedAt">;

/** Why a market could not be mapped, in plain words. */
export class LiquidationMapError extends Error {}

export const okxInstrument = (symbol: string) => `${symbol.replace(/USDT$/, "")}-USDT-SWAP`;

/** Open interest from every exchange that lists the market; a missing one is skipped, not fatal. */
export async function openInterest(
  config: AdapterConfig,
  symbol: string,
  window: LiqMapWindow,
  from: number,
  to: number,
): Promise<{
  series: Record<string, MapOiPoint[]>;
  sources: LiquidationMapDto["sources"];
  errors: string[];
}> {
  const { period } = LIQ_MAP_WINDOW_SPEC[window];
  const fetchers: Record<LiqMapSource, () => Promise<MapOiPoint[]>> = {
    BINANCE: () => fetchBinanceOpenInterest(symbol, period, from, to, config.binance),
    BYBIT: () => fetchBybitOpenInterest(symbol, period, from, to, config.bybit),
    OKX: () => fetchOkxOpenInterest(okxInstrument(symbol), period, from, to, config.okx),
  };
  const results = await Promise.all(
    LIQ_MAP_SOURCES.map(async (exchange) => {
      try {
        const points = await fetchers[exchange]();
        return { exchange, points, ok: points.length >= 2 };
      } catch (err) {
        return {
          exchange,
          points: [] as MapOiPoint[],
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  return {
    series: Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.exchange, r.points])),
    sources: results.map((r) => ({ exchange: r.exchange, ok: r.ok })),
    errors: results.flatMap((r) => ("error" in r && r.error ? [`${r.exchange}: ${r.error}`] : [])),
  };
}

export async function computeLiquidationMap(
  config: AdapterConfig,
  symbol: string,
  window: LiqMapWindow,
  now: number,
): Promise<LiquidationMapData> {
  const spec = LIQ_MAP_WINDOW_SPEC[window];
  const to = Math.floor(now / spec.bucketMs) * spec.bucketMs + spec.bucketMs - 1;
  const from = to + 1 - spec.spanMs;
  const [candles, oi] = await Promise.all([
    fetchBinanceFlowCandles(symbol, spec.period, from, to, config.binance),
    openInterest(config, symbol, window, from, to),
  ]);
  if (Object.keys(oi.series).length === 0) {
    throw new LiquidationMapError(
      `No open interest from any exchange (${oi.errors.join("; ") || "empty responses"})`,
    );
  }
  const map = buildLiquidationMap({ candles, oi: oi.series, bucketMs: spec.bucketMs });
  if (!map) throw new LiquidationMapError(`Not enough candles (${candles.length})`);
  return {
    start: map.start,
    bucketMs: map.bucketMs,
    count: map.count,
    priceMin: map.priceMin,
    priceMax: map.priceMax,
    bins: map.bins,
    cells: Buffer.from(map.cells).toString("base64"),
    maxCellUsd: map.maxCellUsd,
    clusters: map.clusters,
    totalLongUsd: map.totalLongUsd,
    totalShortUsd: map.totalShortUsd,
    sources: oi.sources,
  };
}
