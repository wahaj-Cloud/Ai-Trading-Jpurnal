import { buildLiquidationMap, type MapOiPoint } from "@atc/analytics";
import type { Prisma, PrismaClient } from "@atc/db";
import {
  type AdapterConfig,
  fetchBinanceFlowCandles,
  fetchBinanceOpenInterest,
  fetchBybitOpenInterest,
  fetchOkxOpenInterest,
} from "@atc/exchange-adapters";
import {
  LIQ_MAP_SOURCES,
  LIQ_MAP_SYMBOLS,
  LIQ_MAP_WINDOW_SPEC,
  type LiqMapSource,
  type LiqMapWindow,
  type LiquidationMapDto,
} from "@atc/shared";
import { log } from "../logger.js";

/** The 7-day map uses hourly candles, so it only needs recomputing about once an hour. */
const SLOW_WINDOW_REFRESH_MS = 55 * 60_000;
const CONCURRENCY = 3;

export interface LiqMapDeps {
  db: PrismaClient;
  config: AdapterConfig;
  now?: () => number;
}

const okxInstrument = (symbol: string) => `${symbol.replace(/USDT$/, "")}-USDT-SWAP`;

/** Open interest from every exchange that lists the market; a missing one is skipped, not fatal. */
async function openInterest(
  config: AdapterConfig,
  symbol: string,
  window: LiqMapWindow,
  from: number,
  to: number,
): Promise<{ series: Record<string, MapOiPoint[]>; sources: LiquidationMapDto["sources"] }> {
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
        log.warn("liquidation map: open interest unavailable", {
          exchange,
          symbol,
          err: err instanceof Error ? err.message : String(err),
        });
        return { exchange, points: [] as MapOiPoint[], ok: false };
      }
    }),
  );
  return {
    series: Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.exchange, r.points])),
    sources: results.map((r) => ({ exchange: r.exchange, ok: r.ok })),
  };
}

export async function computeLiquidationMap(
  config: AdapterConfig,
  symbol: string,
  window: LiqMapWindow,
  now: number,
): Promise<Omit<LiquidationMapDto, "symbol" | "window" | "computedAt"> | null> {
  const spec = LIQ_MAP_WINDOW_SPEC[window];
  const to = Math.floor(now / spec.bucketMs) * spec.bucketMs + spec.bucketMs - 1;
  const from = to + 1 - spec.spanMs;
  const [candles, oi] = await Promise.all([
    fetchBinanceFlowCandles(symbol, spec.period, from, to, config.binance),
    openInterest(config, symbol, window, from, to),
  ]);
  if (Object.keys(oi.series).length === 0) return null;
  const map = buildLiquidationMap({ candles, oi: oi.series, bucketMs: spec.bucketMs });
  if (!map) return null;
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

/**
 * Every 5 minutes: the estimated liquidation map for each supported market, from public open
 * interest on Binance, Bybit and OKX. Each market is saved on its own, so one failing market
 * (or exchange) never blocks the others; the previous map stays until a new one is ready.
 */
export async function runLiquidationMaps(
  deps: LiqMapDeps,
): Promise<{ maps: number; failed: number; ms: number }> {
  const started = Date.now();
  const now = (deps.now ?? Date.now)();
  const slow = await deps.db.liquidationMap.findMany({
    where: { window: "7d" },
    select: { symbol: true, computedAt: true },
  });
  const slowAge = new Map(slow.map((r) => [r.symbol, now - r.computedAt.getTime()]));

  const jobs: Array<{ symbol: string; window: LiqMapWindow }> = [];
  for (const symbol of LIQ_MAP_SYMBOLS) {
    jobs.push({ symbol, window: "24h" });
    if ((slowAge.get(symbol) ?? Number.POSITIVE_INFINITY) >= SLOW_WINDOW_REFRESH_MS) {
      jobs.push({ symbol, window: "7d" });
    }
  }

  let maps = 0;
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const job = jobs[next++];
        if (!job) return;
        try {
          const data = await computeLiquidationMap(deps.config, job.symbol, job.window, now);
          if (!data) {
            failed++;
            continue;
          }
          const computedAt = new Date(now);
          const json = data as unknown as Prisma.InputJsonValue;
          await deps.db.liquidationMap.upsert({
            where: { symbol_window: { symbol: job.symbol, window: job.window } },
            create: { symbol: job.symbol, window: job.window, data: json, computedAt },
            update: { data: json, computedAt },
          });
          maps++;
        } catch (err) {
          failed++;
          log.warn("liquidation map failed", {
            ...job,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }),
  );
  return { maps, failed, ms: Date.now() - started };
}
