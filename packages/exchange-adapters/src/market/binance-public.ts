import type { BinanceClientOptions } from "../binance/client.js";
import { readCapped, resolveFetch } from "../http.js";
import { ExchangeHttpError, ExchangeNetworkError } from "../types.js";
import type { MarketCandle } from "./candles.js";

/**
 * Public Binance USDⓈ-M futures market data (no API key): the coin universe, recent candles and
 * funding history. Used by Market Pulse, My Setup Alerts and Strategy Lab.
 */

export interface FuturesListing {
  symbol: string;
  baseAsset: string;
  /** When the contract was listed (ms). */
  onboardDate: number;
  /** 24h traded value in USDT. */
  quoteVolume: number;
  /** Traditional-market contract (gold, silver …) rather than a crypto coin. */
  tradfi: boolean;
}

const base = (o: BinanceClientOptions) => o.futuresBaseUrl ?? "https://fapi.binance.com";

async function getJson(o: BinanceClientOptions, url: string): Promise<unknown> {
  const f = resolveFetch(o);
  let res: Response;
  try {
    res = await f(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new ExchangeNetworkError(err);
  }
  const text = await readCapped(res);
  if (!res.ok) throw new ExchangeHttpError(res.status, null, text.slice(0, 200));
  try {
    return JSON.parse(text);
  } catch {
    throw new ExchangeHttpError(502, null, "Unreadable market data");
  }
}

/** USDT perpetuals that are trading, with their 24h volume. */
export async function fetchBinanceUniverse(
  o: BinanceClientOptions = {},
): Promise<FuturesListing[]> {
  const [info, tickers] = await Promise.all([
    getJson(o, `${base(o)}/fapi/v1/exchangeInfo`) as Promise<{
      symbols?: Array<{
        symbol: string;
        baseAsset: string;
        quoteAsset: string;
        contractType: string;
        status: string;
        onboardDate: number;
      }>;
    }>,
    getJson(o, `${base(o)}/fapi/v1/ticker/24hr`) as Promise<
      Array<{ symbol: string; quoteVolume: string }>
    >,
  ]);
  const volume = new Map((tickers ?? []).map((t) => [t.symbol, Number(t.quoteVolume)]));
  return (
    (info?.symbols ?? [])
      // Gold and silver are listed as "TradFi" perpetuals, whatever their exact contract type name.
      .filter(
        (s) =>
          typeof s.contractType === "string" &&
          (s.contractType.includes("PERPETUAL") || s.contractType.startsWith("TRADIFI")) &&
          s.status === "TRADING" &&
          s.quoteAsset === "USDT",
      )
      .map((s) => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        onboardDate: Number(s.onboardDate),
        quoteVolume: volume.get(s.symbol) ?? 0,
        tradfi: s.contractType !== "PERPETUAL",
      }))
      .filter((s) => Number.isFinite(s.quoteVolume))
  );
}

/** The latest `limit` candles that have closed by `now` (≤ 1,500), oldest first. */
export async function fetchBinanceRecentCandles(
  o: BinanceClientOptions,
  symbol: string,
  interval: "5m" | "15m" | "1h" | "4h" | "1d" | "1w",
  limit: number,
  now = Date.now(),
): Promise<MarketCandle[]> {
  // One extra: the newest row is usually the candle still forming, which is dropped.
  const n = Math.min(1500, limit + 1);
  const rows = (await getJson(
    o,
    `${base(o)}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${n}`,
  )) as unknown[][];
  return (rows ?? [])
    .filter((r) => Number(r[6]) < now) // close time
    .map((r) => ({
      t: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[5]),
    }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c))
    .slice(-limit);
}

/**
 * The latest `limit` candles including the one still forming (as a chart shows them), oldest
 * first. Used where a reading should move with the live candle (indicator gauges).
 */
export async function fetchBinanceLiveCandles(
  o: BinanceClientOptions,
  symbol: string,
  interval: "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "1d" | "1w" | "1M",
  limit: number,
): Promise<MarketCandle[]> {
  const rows = (await getJson(
    o,
    `${base(o)}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${Math.min(1500, limit)}`,
  )) as unknown[][];
  return (rows ?? [])
    .map((r) => ({
      t: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[5]),
    }))
    .filter(
      (c) => Number.isFinite(c.t) && c.o > 0 && c.c > 0 && c.h >= c.l && Number.isFinite(c.v),
    );
}

/** Funding rates in [from, to], oldest first. */
export async function fetchBinanceFunding(
  o: BinanceClientOptions,
  symbol: string,
  from: number,
  to: number,
): Promise<Array<{ t: number; rate: number }>> {
  const out = new Map<number, number>();
  let cursor = from;
  // Funding is every 8 hours or more often; 40 pages covers over two years at 1,000 a page.
  for (let page = 0; page < 40 && cursor <= to; page++) {
    const rows = (await getJson(
      o,
      `${base(o)}/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&startTime=${cursor}&endTime=${to}&limit=1000`,
    )) as Array<{ fundingTime: number; fundingRate: string }>;
    if (!rows?.length) break;
    for (const r of rows) out.set(Number(r.fundingTime), Number(r.fundingRate));
    const last = Math.max(...rows.map((r) => Number(r.fundingTime)));
    if (rows.length < 1000) break;
    cursor = last + 1;
  }
  return [...out.entries()]
    .filter(([t, rate]) => Number.isFinite(t) && Number.isFinite(rate))
    .sort((a, b) => a[0] - b[0])
    .map(([t, rate]) => ({ t, rate }));
}

export interface BinanceMarketNow {
  /** Last traded price and rolling 24h change (%), as Binance shows them. */
  lastPrice: number;
  change24hPct: number;
  /** Mark price and the funding rate that applies at the next settlement (fraction). */
  markPrice: number | null;
  nextFundingRate: number | null;
  nextFundingTime: number | null;
}

/** Current price, 24h change and live funding rate for one market (two light public calls). */
export async function fetchBinanceMarketNow(
  o: BinanceClientOptions,
  symbol: string,
): Promise<BinanceMarketNow> {
  const s = encodeURIComponent(symbol);
  const [ticker, premium] = await Promise.all([
    getJson(o, `${base(o)}/fapi/v1/ticker/24hr?symbol=${s}`) as Promise<{
      lastPrice?: string;
      priceChangePercent?: string;
    }>,
    (
      getJson(o, `${base(o)}/fapi/v1/premiumIndex?symbol=${s}`) as Promise<{
        markPrice?: string;
        lastFundingRate?: string;
        nextFundingTime?: number;
      }>
    ).catch(() => null),
  ]);
  const num = (v: unknown) => {
    const n = Number(v);
    return v !== undefined && v !== null && v !== "" && Number.isFinite(n) ? n : null;
  };
  const lastPrice = num(ticker?.lastPrice);
  const change = num(ticker?.priceChangePercent);
  if (lastPrice === null || lastPrice <= 0 || change === null)
    throw new ExchangeHttpError(502, null, "Binance: no 24h ticker");
  return {
    lastPrice,
    change24hPct: change,
    markPrice: num(premium?.markPrice),
    nextFundingRate: num(premium?.lastFundingRate),
    nextFundingTime: num(premium?.nextFundingTime),
  };
}

/** One-minute candles from `from` (ms, any time inside the first minute), oldest first. */
export async function fetchBinanceMinuteCandles(
  o: BinanceClientOptions,
  symbol: string,
  from: number,
  count: number,
): Promise<MarketCandle[]> {
  const start = Math.floor(from / 60_000) * 60_000;
  const rows = (await getJson(
    o,
    `${base(o)}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&startTime=${start}&limit=${Math.min(1500, count)}`,
  )) as unknown[][];
  return (rows ?? [])
    .map((r) => ({
      t: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[5]),
    }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.o) && Number.isFinite(c.c));
}

/** A closed candle with its traded amount (coins and USDT) and the USDT part bought by takers. */
export interface DeltaCandleRow {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  base: number;
  quote: number;
  takerBuyQuote: number;
}

/** The latest `limit` closed 1- or 5-minute candles with taker-buy value (≤ 1,499), oldest first. */
export async function fetchBinanceDeltaCandles(
  o: BinanceClientOptions,
  symbol: string,
  limit: number,
  now = Date.now(),
  interval: "1m" | "5m" = "5m",
): Promise<DeltaCandleRow[]> {
  const n = Math.min(1500, limit + 1);
  const rows = (await getJson(
    o,
    `${base(o)}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${n}`,
  )) as unknown[][];
  return (rows ?? [])
    .filter((r) => Number(r[6]) < now) // drop the candle still forming
    .map((r) => ({
      t: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      base: Number(r[5]),
      quote: Number(r[7]),
      takerBuyQuote: Number(r[10]),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.t) &&
        c.o > 0 &&
        c.c > 0 &&
        c.h >= Math.max(c.o, c.c) &&
        c.l <= Math.min(c.o, c.c) &&
        c.l > 0 &&
        Number.isFinite(c.base) &&
        c.base >= 0 &&
        Number.isFinite(c.quote) &&
        c.quote >= 0 &&
        Number.isFinite(c.takerBuyQuote) &&
        c.takerBuyQuote >= 0 &&
        c.takerBuyQuote <= c.quote * (1 + 1e-9),
    )
    .slice(-limit);
}

/** Open interest right now, in coins, with Binance's timestamp. */
export async function fetchBinanceOpenInterestNow(
  o: BinanceClientOptions,
  symbol: string,
): Promise<{ t: number; oi: number }> {
  const r = (await getJson(
    o,
    `${base(o)}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`,
  )) as { openInterest?: string; time?: number };
  const oi = Number(r?.openInterest);
  const t = Number(r?.time);
  if (!Number.isFinite(oi) || oi < 0 || !Number.isFinite(t))
    throw new ExchangeHttpError(502, null, "Binance: no open interest");
  return { t, oi };
}

/** Order book levels (price, quantity in coins), best first on each side; at most 1,000 a side. */
export async function fetchBinanceDepth(
  o: BinanceClientOptions,
  symbol: string,
  limit: 100 | 500 | 1000 = 1000,
): Promise<{ bids: Array<[number, number]>; asks: Array<[number, number]>; t: number }> {
  const r = (await getJson(
    o,
    `${base(o)}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
  )) as { bids?: string[][]; asks?: string[][]; T?: number; E?: number };
  const parse = (rows: string[][] | undefined) =>
    (rows ?? [])
      .map((x) => [Number(x[0]), Number(x[1])] as [number, number])
      .filter(([p, q]) => p > 0 && q > 0 && Number.isFinite(p) && Number.isFinite(q));
  const bids = parse(r?.bids).sort((a, b) => b[0] - a[0]);
  const asks = parse(r?.asks).sort((a, b) => a[0] - b[0]);
  return { bids, asks, t: Number(r?.T ?? r?.E ?? Date.now()) };
}

/** Next-settlement funding rate (fraction) of every USDⓈ-M contract, in one call. */
export async function fetchBinanceFundingAll(
  o: BinanceClientOptions = {},
): Promise<Map<string, number>> {
  const rows = (await getJson(o, `${base(o)}/fapi/v1/premiumIndex`)) as Array<{
    symbol: string;
    lastFundingRate: string;
  }>;
  const out = new Map<string, number>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.lastFundingRate === "" || r.lastFundingRate === undefined) continue;
    const v = Number(r.lastFundingRate);
    if (Number.isFinite(v)) out.set(r.symbol, v);
  }
  return out;
}
