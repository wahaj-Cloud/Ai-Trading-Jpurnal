import type { PrismaClient } from "@atc/db";
import {
  type AdapterConfig,
  fetchBinanceFunding,
  fetchCandles,
  type MarketCandle,
} from "@atc/exchange-adapters";
import type { SetupExchange, Timeframe } from "@atc/shared";
import { TIMEFRAME_MS } from "@atc/ta";
import type { Redis } from "ioredis";

/**
 * Shared market-data store: public candles and funding rates, downloaded once and reused by every
 * backtest and setup scan. Only closed candles are stored, so stored rows never change.
 */

export interface MarketDataDeps {
  db: PrismaClient;
  config: AdapterConfig;
  /** Remembers ranges already downloaded, so natural gaps (a coin listed later) are not refetched. */
  redis?: Pick<Redis, "get" | "set">;
  now?: () => number;
}

/** One fetchCandles call covers at most this many candles (8 pages of 1,500). */
const CHUNK = 12_000;
const INSERT_BATCH = 2_000;

export async function saveCandles(
  db: PrismaClient,
  exchange: SetupExchange,
  symbol: string,
  tf: Timeframe,
  candles: readonly MarketCandle[],
): Promise<void> {
  for (let i = 0; i < candles.length; i += INSERT_BATCH) {
    await db.marketCandle.createMany({
      data: candles.slice(i, i + INSERT_BATCH).map((c) => ({
        exchange,
        symbol,
        timeframe: tf,
        openTime: new Date(c.t),
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v,
      })),
      skipDuplicates: true,
    });
  }
}

async function storedCandles(
  db: PrismaClient,
  exchange: SetupExchange,
  symbol: string,
  tf: Timeframe,
  from: number,
  to: number,
): Promise<MarketCandle[]> {
  const rows = await db.marketCandle.findMany({
    where: {
      exchange,
      symbol,
      timeframe: tf,
      openTime: { gte: new Date(from), lte: new Date(to) },
    },
    orderBy: { openTime: "asc" },
    select: { openTime: true, open: true, high: true, low: true, close: true, volume: true },
  });
  return rows.map((r) => ({
    t: r.openTime.getTime(),
    o: r.open,
    h: r.high,
    l: r.low,
    c: r.close,
    v: r.volume,
  }));
}

/**
 * Closed candles for [from, to], downloading only what is missing. Gaps are found by comparing the
 * stored count with the expected count for each chunk, so a fully stored range costs one query.
 */
export async function ensureCandles(
  deps: MarketDataDeps,
  exchange: SetupExchange,
  symbol: string,
  tf: Timeframe,
  from: number,
  to: number,
  onChunk?: (done: number) => void,
): Promise<MarketCandle[]> {
  const step = TIMEFRAME_MS[tf];
  const now = (deps.now ?? Date.now)();
  const start = Math.ceil(from / step) * step;
  // The newest candle that has closed.
  const end = Math.min(Math.floor(to / step) * step, Math.floor(now / step) * step - step);
  if (end < start) return [];
  const chunks = Math.ceil((end - start + step) / (CHUNK * step));
  for (let k = 0; k < chunks; k++) {
    const a = start + k * CHUNK * step;
    const b = Math.min(end, a + (CHUNK - 1) * step);
    const expected = Math.round((b - a) / step) + 1;
    const have = await deps.db.marketCandle.count({
      where: { exchange, symbol, timeframe: tf, openTime: { gte: new Date(a), lte: new Date(b) } },
    });
    const key = `candles:done:${exchange}:${symbol}:${tf}:${a}:${b}`;
    // A coin listed after `a` legitimately has fewer candles: download each range only once.
    if (have < expected && !(await deps.redis?.get(key))) {
      const fresh = await fetchCandles(exchange, deps.config, symbol, tf, a, b);
      await saveCandles(deps.db, exchange, symbol, tf, fresh);
      await deps.redis?.set(key, "1", "EX", 30 * 86_400);
    }
    onChunk?.((k + 1) / chunks);
  }
  return storedCandles(deps.db, exchange, symbol, tf, start, end);
}

/** Funding rates for [from, to], downloading what is missing. */
export async function ensureFunding(
  deps: MarketDataDeps,
  exchange: SetupExchange,
  symbol: string,
  from: number,
  to: number,
): Promise<Array<{ t: number; rate: number }>> {
  const latest = await deps.db.fundingRate.findFirst({
    where: { exchange, symbol },
    orderBy: { fundingTime: "desc" },
    select: { fundingTime: true },
  });
  const earliest = await deps.db.fundingRate.findFirst({
    where: { exchange, symbol },
    orderBy: { fundingTime: "asc" },
    select: { fundingTime: true },
  });
  const ranges: Array<[number, number]> = [];
  if (!latest || !earliest) ranges.push([from, to]);
  else {
    // Funding is at least every 8 hours: anything stored within 8h of an edge counts as covered.
    if (earliest.fundingTime.getTime() > from + 8 * 3_600_000)
      ranges.push([from, earliest.fundingTime.getTime() - 1]);
    if (latest.fundingTime.getTime() < to - 8 * 3_600_000)
      ranges.push([latest.fundingTime.getTime() + 1, to]);
  }
  for (const [a, b] of ranges) {
    const rows = await fetchBinanceFunding(deps.config.binance ?? {}, symbol, a, b);
    if (rows.length)
      await deps.db.fundingRate.createMany({
        data: rows.map((r) => ({ exchange, symbol, fundingTime: new Date(r.t), rate: r.rate })),
        skipDuplicates: true,
      });
  }
  const rows = await deps.db.fundingRate.findMany({
    where: { exchange, symbol, fundingTime: { gte: new Date(from), lte: new Date(to) } },
    orderBy: { fundingTime: "asc" },
    select: { fundingTime: true, rate: true },
  });
  return rows.map((r) => ({ t: r.fundingTime.getTime(), rate: r.rate }));
}
