import type { Prisma, PrismaClient } from "@atc/db";
import { writeSnapshot } from "@atc/db";
import {
  type AdapterConfig,
  type DeliveryContract,
  fetchBinanceBasis,
  fetchBinanceFlowCandles,
  fetchBinanceFunding,
  fetchBinanceLongShort,
  fetchBinanceMarketNow,
  fetchBinanceQuarterlies,
  fetchBinanceRecentCandles,
  fetchCoinbasePremium,
  fetchDeribitOptions,
  fetchFredSeries,
  fetchStablecoinSupply,
  type SourceOptions,
} from "@atc/exchange-adapters";
import {
  contextKey,
  DESK_SYMBOLS,
  type DeskSymbol,
  FRED_SERIES,
  type KeyLevels,
  MACRO_KEY,
  type MacroDto,
  type MacroSeriesDto,
  type MarketContextDto,
  STABLECOINS_KEY,
} from "@atc/shared";
import { biasHistory, ema, timeframeBias } from "@atc/ta";
import { log } from "../logger.js";
import { oiChange } from "./desk.js";

const H = 3_600_000;
const DAY = 24 * H;

/** Where each market's extra readings come from (Binance futures pair, spot coin, options). */
const SOURCES: Record<DeskSymbol, { coinbase: string | null; options: "BTC" | "ETH" | null }> = {
  BTCUSDT: { coinbase: "BTC", options: "BTC" },
  ETHUSDT: { coinbase: "ETH", options: "ETH" },
  SOLUSDT: { coinbase: "SOL", options: null },
  XAUUSDT: { coinbase: null, options: null },
  XAGUSDT: { coinbase: null, options: null },
};

export interface ContextDeps {
  db: PrismaClient;
  config: AdapterConfig;
  /** Free FRED key for the macro readings; without it they are skipped. */
  fredApiKey?: string;
  sources?: {
    deribit?: SourceOptions;
    coinbase?: SourceOptions;
    binanceSpot?: SourceOptions;
    fred?: SourceOptions;
    llama?: SourceOptions;
  };
  now?: () => number;
}

async function settle<T>(what: string, symbol: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    log.warn("market context reading unavailable", {
      what,
      symbol,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function save(db: PrismaClient, key: string, data: unknown, now: number) {
  const json = data as Prisma.InputJsonValue;
  await writeSnapshot(db, key, json, new Date(now));
}

/** Previous day and week ranges and the daily 50/200 EMAs, from closed candles. */
export function keyLevels(
  daily: ReadonlyArray<{ h: number; l: number; c: number }>,
  weekly: ReadonlyArray<{ h: number; l: number }>,
): KeyLevels | null {
  const d = daily.at(-1);
  if (!d) return null;
  const w = weekly.at(-1);
  const closes = daily.map((c) => c.c);
  return {
    prevDayHigh: d.h,
    prevDayLow: d.l,
    prevWeekHigh: w?.h ?? null,
    prevWeekLow: w?.l ?? null,
    ema200d: closes.length >= 200 ? (ema(closes, 200).at(-1) ?? null) : null,
    ema50d: closes.length >= 50 ? (ema(closes, 50).at(-1) ?? null) : null,
  };
}

/** Taker buy ÷ taker sell volume over the last 4 and 24 closed hourly candles. */
export function takerRatios(
  candles: ReadonlyArray<{ v: number; takerBuyShare: number | null }>,
): { ratio4h: number; ratio24h: number } | null {
  const ratio = (rows: typeof candles) => {
    let buy = 0;
    let sell = 0;
    for (const c of rows) {
      if (c.takerBuyShare === null) continue;
      buy += c.v * c.takerBuyShare;
      sell += c.v * (1 - c.takerBuyShare);
    }
    return sell > 0 ? buy / sell : null;
  };
  if (candles.length < 24) return null;
  const r4 = ratio(candles.slice(-4));
  const r24 = ratio(candles.slice(-24));
  return r4 !== null && r24 !== null ? { ratio4h: r4, ratio24h: r24 } : null;
}

/**
 * Every 15 minutes: the Trade Check readings for each desk market. Each reading is fetched on its
 * own, so one unavailable source leaves a gap instead of hiding the rest. Macro (FRED) and
 * stablecoin supply change daily and are refreshed at most hourly.
 */
export async function runMarketContext(
  deps: ContextDeps,
): Promise<{ saved: DeskSymbol[]; failed: DeskSymbol[]; macro: boolean; stablecoins: boolean }> {
  const now = (deps.now ?? Date.now)();
  const binance = deps.config.binance ?? {};
  const src = deps.sources ?? {};
  const saved: DeskSymbol[] = [];
  const failed: DeskSymbol[] = [];

  const quarterlies: DeliveryContract[] =
    (await settle(
      "quarterly contracts",
      "*",
      fetchBinanceQuarterlies({ ...binance, baseUrl: binance.futuresBaseUrl }),
    )) ?? [];

  for (const symbol of DESK_SYMBOLS) {
    try {
      const where = SOURCES[symbol];
      const [ticker, oi, flow, daily, weekly, accounts, top, basis, premium, options] =
        await Promise.all([
          settle("ticker", symbol, fetchBinanceMarketNow(binance, symbol)),
          settle("open interest", symbol, oiChange(deps.config, symbol, now)),
          settle(
            "taker volume",
            symbol,
            fetchBinanceFlowCandles(symbol, "1h", now - 26 * H, now, binance),
          ),
          settle(
            "daily candles",
            symbol,
            fetchBinanceRecentCandles(binance, symbol, "1d", 400, now),
          ),
          settle(
            "weekly candles",
            symbol,
            fetchBinanceRecentCandles(binance, symbol, "1w", 400, now),
          ),
          settle(
            "long/short accounts",
            symbol,
            fetchBinanceLongShort(
              { ...binance, baseUrl: binance.futuresBaseUrl },
              symbol,
              "accounts",
            ),
          ),
          settle(
            "long/short top traders",
            symbol,
            fetchBinanceLongShort(
              { ...binance, baseUrl: binance.futuresBaseUrl },
              symbol,
              "topPositions",
            ),
          ),
          settle(
            "basis",
            symbol,
            fetchBinanceBasis(
              { ...binance, baseUrl: binance.futuresBaseUrl },
              quarterlies,
              symbol,
              now,
            ),
          ),
          where.coinbase
            ? settle(
                "coinbase premium",
                symbol,
                fetchCoinbasePremium(
                  { coinbase: src.coinbase, binanceSpot: src.binanceSpot },
                  where.coinbase,
                ),
              )
            : null,
          where.options
            ? settle("options", symbol, fetchDeribitOptions(src.deribit ?? {}, where.options, now))
            : null,
        ]);
      if (!ticker && !daily) throw new Error("no price data");
      const closedFlow = (flow ?? []).filter((c) => c.t + H <= now);
      const data: MarketContextDto = {
        symbol,
        computedAt: new Date(now).toISOString(),
        price: ticker?.lastPrice ?? daily?.at(-1)?.c ?? null,
        change24hPct: ticker?.change24hPct ?? null,
        fundingRate: ticker?.nextFundingRate ?? null,
        oiChange24hPct: oi,
        weeklyBias: weekly ? timeframeBias(weekly, "1w") : null,
        levels: daily ? keyLevels(daily, weekly ?? []) : null,
        accounts,
        topPositions: top,
        taker: takerRatios(closedFlow),
        basis,
        coinbasePremiumPct: premium,
        options,
      };
      await save(deps.db, contextKey(symbol), data, now);
      saved.push(symbol);
    } catch (err) {
      failed.push(symbol);
      log.warn("market context failed", {
        symbol,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Daily data, refreshed at most hourly.
  const old = await deps.db.marketSnapshot.findMany({
    where: { key: { in: [MACRO_KEY, STABLECOINS_KEY] } },
    select: { key: true, updatedAt: true },
  });
  const due = (key: string) => {
    const row = old.find((o) => o.key === key);
    return !row || now - row.updatedAt.getTime() >= 55 * 60_000;
  };
  let macro = false;
  if (deps.fredApiKey && due(MACRO_KEY)) {
    const series: MacroSeriesDto[] = [];
    for (const id of FRED_SERIES) {
      const s = await settle(
        "FRED",
        id,
        fetchFredSeries({ ...(src.fred ?? {}), apiKey: deps.fredApiKey }, id),
      );
      if (s) series.push(s);
    }
    if (series.length > 0) {
      const dto: MacroDto = { series, updatedAt: new Date(now).toISOString() };
      await save(deps.db, MACRO_KEY, dto, now);
      macro = true;
    }
  }
  let stablecoins = false;
  if (due(STABLECOINS_KEY)) {
    const s = await settle("stablecoins", "*", fetchStablecoinSupply(src.llama ?? {}, now));
    if (s) {
      await save(deps.db, STABLECOINS_KEY, s, now);
      stablecoins = true;
    }
  }
  return { saved, failed, macro, stablecoins };
}

const KEEP_MS = 400 * DAY;

/**
 * Hourly: trend bias after every closed daily and 4-hour candle, and settled funding rates, so
 * Trade Check can show how the trader did in each condition. A new install fills about 400 days
 * at once; afterwards only new rows are added.
 */
export async function runMarketHistory(
  deps: Pick<ContextDeps, "db" | "config" | "now">,
): Promise<{ trendRows: number; fundingRows: number; failed: DeskSymbol[] }> {
  const now = (deps.now ?? Date.now)();
  const binance = deps.config.binance ?? {};
  let trendRows = 0;
  let fundingRows = 0;
  const failed: DeskSymbol[] = [];
  for (const symbol of DESK_SYMBOLS) {
    try {
      const [daily, fourHour] = await Promise.all([
        fetchBinanceRecentCandles(binance, symbol, "1d", 1000, now),
        fetchBinanceRecentCandles(binance, symbol, "4h", 1500, now),
      ]);
      const rows = [
        ...biasHistory(daily, DAY).map((r) => ({ timeframe: "1d", ...r })),
        ...biasHistory(fourHour, 4 * H).map((r) => ({ timeframe: "4h", ...r })),
      ]
        .filter((r) => r.at >= now - KEEP_MS)
        .map((r) => ({ symbol, timeframe: r.timeframe, at: new Date(r.at), state: r.state }));
      // Rows already saved keep their first value; the latest closes are added.
      const res = await deps.db.marketTrendHistory.createMany({ data: rows, skipDuplicates: true });
      trendRows += res.count;

      const last = await deps.db.fundingRateHistory.findFirst({
        where: { symbol },
        orderBy: { at: "desc" },
        select: { at: true },
      });
      const from = Math.max(now - KEEP_MS, (last?.at.getTime() ?? 0) + 1);
      const funding = await fetchBinanceFunding(binance, symbol, from, now);
      if (funding.length > 0) {
        const f = await deps.db.fundingRateHistory.createMany({
          data: funding.map((r) => ({ symbol, at: new Date(r.t), rate: r.rate.toFixed(10) })),
          skipDuplicates: true,
        });
        fundingRows += f.count;
      }
    } catch (err) {
      failed.push(symbol);
      log.warn("market history failed", {
        symbol,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const cutoff = new Date(now - KEEP_MS);
  await deps.db.marketTrendHistory.deleteMany({ where: { at: { lt: cutoff } } });
  await deps.db.fundingRateHistory.deleteMany({ where: { at: { lt: cutoff } } });
  return { trendRows, fundingRows, failed };
}
