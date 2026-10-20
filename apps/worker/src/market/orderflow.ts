import type { Prisma, PrismaClient } from "@atc/db";
import {
  type AdapterConfig,
  type FuturesListing,
  fetchBinanceDeltaCandles,
  fetchBinanceDepth,
  fetchBinanceFundingAll,
  fetchBinanceOpenInterest,
  fetchBinanceOpenInterestNow,
  fetchBinanceUniverse,
} from "@atc/exchange-adapters";
import {
  aggregate,
  atr,
  bookPressure,
  type DeltaCandle,
  dayVwap,
  FAST_LOOKBACK_CANDLES,
  FAST_WINDOWS,
  isPinned,
  mergeLevels,
  ORDERFLOW_COINS,
  type OrderflowCoinDto,
  type OrderflowWindow,
  type OrderflowWindowSnapshot,
  orderflowKey,
  orderflowMetrics,
  SCALP_BOOK_COINS,
  SCALP_KEY,
  SCALP_PINNED,
  type ScalpCoinDto,
  type ScalpLevelsDto,
  type ScalpSnapshot,
  SLOW_LOOKBACK_CANDLES,
  SLOW_WINDOWS,
  scalpLevels,
  shortVolatility,
  summarizeWindow,
} from "@atc/shared";
import type { Redis } from "ioredis";
import { log } from "../logger.js";

/** A coin needs a full day of candles to fill the 1D window. */
const MIN_LISTED_MS = 2 * 86_400_000;
const CONCURRENCY = 8;
const M1 = 60_000;
const M5 = 300_000;
/** Below this share of the top coins a scan is treated as failed and the old snapshot kept. */
const MIN_COVERAGE = 0.6;
/** Today's VWAP, levels and 1-hour ATR per coin, written by the 5-minute scan for the 1-minute one. */
export const VWAP_KEY = "orderflow:vwap";
interface LevelsRow {
  asOf: string;
  vwap: Record<string, number | null>;
  levels: Record<string, ScalpLevelsDto | null>;
  atr1h: Record<string, number | null>;
}
/** Live open interest readings are kept this long in Redis (the 1H window plus margin). */
const OI_KEEP_MS = 75 * M1;
const oiKey = (symbol: string) => `of:oi:${symbol}`;

export interface OrderflowDeps {
  db: PrismaClient;
  config: AdapterConfig;
  now?: () => number;
}
export interface FastOrderflowDeps extends OrderflowDeps {
  redis: Redis;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

const saveJson = (db: PrismaClient, key: string, value: unknown, at: Date) => {
  const data = value as Prisma.InputJsonValue;
  return db.marketSnapshot.upsert({
    where: { key },
    create: { key, data, updatedAt: at },
    update: { data, updatedAt: at },
  });
};

/**
 * The 100 most traded contracts listed for at least two days, most traded first, plus gold and
 * silver whatever their rank. Rank is the place by 24h volume among those contracts.
 */
function topCoins(
  listings: FuturesListing[],
  now: number,
): { universe: FuturesListing[]; rank: Map<string, number> } {
  const eligible = listings
    .filter((s) => now - s.onboardDate >= MIN_LISTED_MS && s.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
  const universe = eligible.slice(0, ORDERFLOW_COINS);
  for (const p of SCALP_PINNED) {
    const listing = eligible.find((s) => s.symbol === p);
    if (listing && !universe.includes(listing)) universe.push(listing);
  }
  return { universe, rank: new Map(eligible.map((s, i) => [s.symbol, i + 1])) };
}

const fundingOrEmpty = (binance: AdapterConfig["binance"]) =>
  fetchBinanceFundingAll(binance ?? {}).catch((err) => {
    log.warn("order flow funding unavailable", { err });
    return new Map<string, number>();
  });

interface CoinData {
  coin: FuturesListing;
  candles: DeltaCandle[];
  oi: Array<{ t: number; oi: number }>;
}

function buildWindows(
  windows: readonly OrderflowWindow[],
  ok: CoinData[],
  rank: Map<string, number>,
  funding: Map<string, number>,
) {
  return windows.map((w) => {
    const coins: OrderflowCoinDto[] = [];
    for (const { coin, candles, oi } of ok) {
      const m = orderflowMetrics(candles, oi, w);
      if (!m) continue;
      coins.push({
        symbol: coin.symbol,
        rank: rank.get(coin.symbol) ?? 999,
        funding: funding.get(coin.symbol) ?? null,
        ...m,
      });
    }
    coins.sort((a, b) => a.rank - b.rank);
    return summarizeWindow(w, coins);
  });
}

/**
 * Every 5 minutes: the 4H and 1D windows from 5-minute candles and Binance's 5-minute open
 * interest history, plus each coin's VWAP since 00:00 UTC. One candle request and one open
 * interest request per coin. Each window is saved as its own row, replacing the last one.
 */
export async function runOrderflow(
  deps: OrderflowDeps,
): Promise<{ coins: number; failed: number; ms: number }> {
  const started = Date.now();
  const now = (deps.now ?? Date.now)();
  const binance = deps.config.binance ?? {};
  const [listings, funding] = await Promise.all([
    fetchBinanceUniverse(binance),
    fundingOrEmpty(binance),
  ]);
  const { universe, rank } = topCoins(listings, now);
  if (universe.length === 0) throw new Error("No Binance futures listings");

  const lastClose = Math.floor(now / M5) * M5;
  const from = lastClose - (SLOW_LOOKBACK_CANDLES + 2) * M5;
  let failed = 0;
  const perCoin = await mapLimit(universe, CONCURRENCY, async (coin) => {
    try {
      const [candles, oi] = await Promise.all([
        fetchBinanceDeltaCandles(binance, coin.symbol, SLOW_LOOKBACK_CANDLES, now, "5m"),
        fetchBinanceOpenInterest(coin.symbol, "5m", from, now, binance).catch((err) => {
          log.warn("order flow open interest unavailable", { symbol: coin.symbol, err });
          return [];
        }),
      ]);
      // A gap at the end (delisting, halted market) would make "now" stale for this coin.
      if (!candles.length || (candles.at(-1)?.t ?? 0) < lastClose - 2 * M5) return null;
      return { coin, candles, oi };
    } catch (err) {
      failed++;
      log.warn("order flow coin failed", { symbol: coin.symbol, err });
      return null;
    }
  });
  const ok = perCoin.filter((x) => x !== null);
  if (ok.length < Math.ceil(universe.length * MIN_COVERAGE))
    throw new Error(`Order flow: only ${ok.length} of ${universe.length} coins answered`);

  const asOf = Math.max(...ok.map((x) => (x.candles.at(-1)?.t ?? 0) + M5));
  const windows = buildWindows(SLOW_WINDOWS, ok, rank, funding);
  const vwap = Object.fromEntries(
    ok.map(({ coin, candles }) => [coin.symbol, dayVwap(candles, asOf)] as const),
  );
  const levels = Object.fromEntries(
    ok.map(({ coin, candles }) => [coin.symbol, scalpLevels(candles, asOf)] as const),
  );
  const atr1h = Object.fromEntries(
    ok.map(({ coin, candles }) => [coin.symbol, atr(aggregate(candles, M5, 12))] as const),
  );
  const computedAt = new Date(now);
  await deps.db.$transaction([
    ...windows.map((w) => {
      const row: OrderflowWindowSnapshot = {
        computedAt: computedAt.toISOString(),
        asOf: new Date(asOf).toISOString(),
        universe: universe.length,
        ...w,
      };
      return saveJson(deps.db, orderflowKey(w.window), row, computedAt);
    }),
    saveJson(
      deps.db,
      VWAP_KEY,
      { asOf: new Date(asOf).toISOString(), vwap, levels, atr1h } satisfies LevelsRow,
      computedAt,
    ),
  ]);
  return { coins: ok.length, failed, ms: Date.now() - started };
}

// ─── 1-minute scan ───

let universeCache: { at: number; list: FuturesListing[] } | null = null;
/** The coin list changes slowly and the 24h ticker is a heavy request: refreshed every 5 minutes. */
async function cachedUniverse(binance: AdapterConfig["binance"], now: number) {
  if (universeCache && now - universeCache.at < 5 * M1 && now >= universeCache.at)
    return universeCache.list;
  const list = await fetchBinanceUniverse(binance ?? {});
  universeCache = { at: now, list };
  return list;
}
/** For tests. */
export function resetOrderflowCache() {
  universeCache = null;
}

/**
 * Live open interest: the reading taken now is added to the coin's Redis buffer, and the buffer
 * (readings up to 75 minutes old) is returned. A coin with no history yet (first minutes after a
 * deploy) is seeded from Binance's 5-minute open-interest history.
 */
async function liveOpenInterest(
  deps: FastOrderflowDeps,
  symbol: string,
  now: number,
): Promise<Array<{ t: number; oi: number }>> {
  const binance = deps.config.binance ?? {};
  const key = oiKey(symbol);
  const reading = await fetchBinanceOpenInterestNow(binance, symbol);
  const add: Array<{ t: number; oi: number }> = [reading];
  const count = await deps.redis.zcount(key, now - OI_KEEP_MS, "+inf");
  if (count < 3) {
    const hist = await fetchBinanceOpenInterest(symbol, "5m", now - OI_KEEP_MS, now, binance).catch(
      () => [],
    );
    add.push(...hist);
  }
  const multi = deps.redis.multi();
  for (const p of add) multi.zadd(key, p.t, `${p.t}:${p.oi}`);
  multi.zremrangebyscore(key, "-inf", now - OI_KEEP_MS);
  multi.pexpire(key, 2 * OI_KEEP_MS);
  multi.zrangebyscore(key, now - OI_KEEP_MS, "+inf");
  const res = await multi.exec();
  const members = (res?.at(-1)?.[1] as string[] | undefined) ?? [];
  const byTime = new Map<number, number>();
  for (const m of members) {
    const [t, oi] = m.split(":").map(Number);
    if (Number.isFinite(t) && Number.isFinite(oi)) byTime.set(t as number, oi as number);
  }
  return [...byTime].map(([t, oi]) => ({ t, oi })).sort((a, b) => a.t - b.t);
}

/**
 * Every minute: the 5m, 15m, 30m and 1H windows from 1-minute candles (4 hours, which also give the
 * normal volume to compare against) and live open interest; then the scalping snapshot: every
 * coin on all six timeframes, today's VWAP distance and the order book of the 20 most traded.
 */
export async function runOrderflowFast(
  deps: FastOrderflowDeps,
): Promise<{ coins: number; failed: number; books: number; ms: number; scalp: ScalpSnapshot }> {
  const started = Date.now();
  const now = (deps.now ?? Date.now)();
  const binance = deps.config.binance ?? {};
  const [listings, funding] = await Promise.all([
    cachedUniverse(binance, now),
    fundingOrEmpty(binance),
  ]);
  const { universe, rank } = topCoins(listings, now);
  if (universe.length === 0) throw new Error("No Binance futures listings");
  const lastClose = Math.floor(now / M1) * M1;
  let failed = 0;
  const perCoin = await mapLimit(universe, CONCURRENCY, async (coin) => {
    try {
      const [candles, oi] = await Promise.all([
        fetchBinanceDeltaCandles(binance, coin.symbol, FAST_LOOKBACK_CANDLES, now, "1m"),
        liveOpenInterest(deps, coin.symbol, now).catch((err) => {
          log.warn("order flow live open interest unavailable", { symbol: coin.symbol, err });
          return [];
        }),
      ]);
      if (!candles.length || (candles.at(-1)?.t ?? 0) < lastClose - 3 * M1) return null;
      return { coin, candles, oi };
    } catch (err) {
      failed++;
      log.warn("order flow (1m) coin failed", { symbol: coin.symbol, err });
      return null;
    }
  });
  const ok = perCoin.filter((x) => x !== null);
  if (ok.length < Math.ceil(universe.length * MIN_COVERAGE))
    throw new Error(`Order flow (1m): only ${ok.length} of ${universe.length} coins answered`);

  const asOf = Math.max(...ok.map((x) => (x.candles.at(-1)?.t ?? 0) + M1));
  const windows = buildWindows(FAST_WINDOWS, ok, rank, funding);

  // Order books of the most traded coins (a heavier request, so only these).
  const bookCoins = ok.filter(
    (x) => (rank.get(x.coin.symbol) ?? 999) <= SCALP_BOOK_COINS || isPinned(x.coin.symbol),
  );
  const books = new Map(
    (
      await mapLimit(bookCoins, 4, async ({ coin }) => {
        try {
          const d = await fetchBinanceDepth(binance, coin.symbol, 1000);
          return [coin.symbol, bookPressure(d.bids, d.asks, new Date(d.t))] as const;
        } catch (err) {
          log.warn("order book unavailable", { symbol: coin.symbol, err });
          return [coin.symbol, null] as const;
        }
      })
    ).filter(([, b]) => b !== null),
  );

  // The scalping snapshot joins these windows with the latest 4H/1D rows and VWAPs.
  const [slowRows, vwapRow] = await Promise.all([
    deps.db.marketSnapshot.findMany({ where: { key: { in: SLOW_WINDOWS.map(orderflowKey) } } }),
    deps.db.marketSnapshot.findUnique({ where: { key: VWAP_KEY } }),
  ]);
  const slow = slowRows
    .map((r) => r.data as unknown as OrderflowWindowSnapshot)
    // Older than 20 minutes: left out rather than shown as current.
    .filter((s) => s?.coins && now - Date.parse(s.computedAt) <= 20 * M1);
  const vwapData = vwapRow?.data as Partial<LevelsRow> | null;
  const levelsAt = vwapData?.asOf ? Date.parse(vwapData.asOf) : Number.NaN;
  const vwapFresh =
    now - levelsAt <= 20 * M1 &&
    // A VWAP from yesterday's session is not today's.
    Math.floor(levelsAt / 86_400_000) === Math.floor(now / 86_400_000);
  const all = [...windows, ...slow];
  const scalpCoins: ScalpCoinDto[] = ok.map(({ coin, candles }) => {
    const price = candles.at(-1)?.c ?? 0;
    const vwap = vwapFresh ? (vwapData?.vwap?.[coin.symbol] ?? null) : null;
    // Levels need the 5-minute scan's full day; fresher 1-minute highs and lows are added to them.
    const slowLevels = vwapFresh ? (vwapData?.levels?.[coin.symbol] ?? null) : null;
    const levels = slowLevels ? mergeLevels(slowLevels, scalpLevels(candles, asOf)) : null;
    const frames: ScalpCoinDto["frames"] = {};
    for (const w of all) {
      const c = w.coins.find((x) => x.symbol === coin.symbol);
      if (!c) continue;
      frames[w.window] = {
        strength: c.strength,
        buyPressurePct: c.buyPressurePct,
        netFlowUsd: c.netFlowUsd,
        priceChangePct: c.priceChangePct,
        oiChangePct: c.oiChangePct,
        relVolume: c.relVolume,
        regime: c.regime,
      };
    }
    return {
      symbol: coin.symbol,
      rank: rank.get(coin.symbol) ?? 999,
      price,
      vwap,
      vwapDistPct: vwap && vwap > 0 ? (price / vwap - 1) * 100 : null,
      funding: funding.get(coin.symbol) ?? null,
      frames,
      book: books.get(coin.symbol) ?? null,
      levels,
      volatility: {
        ...shortVolatility(candles),
        atr1h: vwapFresh ? (vwapData?.atr1h?.[coin.symbol] ?? null) : null,
      },
    };
  });
  scalpCoins.sort((a, b) => a.rank - b.rank);

  const computedAt = new Date(now);
  const scalp: ScalpSnapshot = {
    computedAt: computedAt.toISOString(),
    asOf: new Date(asOf).toISOString(),
    universe: universe.length,
    coins: scalpCoins,
  };
  await deps.db.$transaction([
    ...windows.map((w) => {
      const row: OrderflowWindowSnapshot = {
        computedAt: computedAt.toISOString(),
        asOf: new Date(asOf).toISOString(),
        universe: universe.length,
        ...w,
      };
      return saveJson(deps.db, orderflowKey(w.window), row, computedAt);
    }),
    saveJson(deps.db, SCALP_KEY, scalp, computedAt),
  ]);
  return { coins: ok.length, failed, books: books.size, ms: Date.now() - started, scalp };
}
