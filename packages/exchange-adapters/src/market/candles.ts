import type { ExchangeId, Timeframe } from "@atc/shared";
import { readCapped, resolveFetch } from "../http.js";
import type { AdapterConfig } from "../registry.js";
import { ExchangeHttpError, ExchangeNetworkError } from "../types.js";

/** One OHLCV candle (open time in ms, UTC). */
export interface MarketCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const TF_MS: Record<Timeframe, number> = {
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
};
/** Hard cap per call so one trade can never trigger a long download. */
const MAX_PAGES = 8;

/** The exchange's own symbol for a pair (reverse of canonicalSymbol). */
export function nativeSymbol(
  exchange: ExchangeId,
  symbol: string,
  base: string,
  quote: string,
): string {
  switch (exchange) {
    case "BINANCE":
      return symbol;
    case "MEXC":
      return `${base}_${quote}`;
    case "KUCOIN":
      return `${base === "BTC" ? "XBT" : base}${quote}M`;
    case "BINGX":
      return `${base}-${quote}`;
    case "BYBIT":
      return quote === "USDC" ? `${base}PERP` : symbol;
    case "OKX":
      return `${base}-${quote}-SWAP`;
    case "EXNESS":
      return symbol;
  }
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new ExchangeNetworkError(err);
  }
  const text = await readCapped(res);
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // leave null
  }
  if (!res.ok) throw new ExchangeHttpError(res.status, null, text.slice(0, 200));
  return json;
}

const num = (v: unknown) => Number(v);

type Page = (from: number, to: number) => Promise<MarketCandle[]>;

function pager(
  exchange: ExchangeId,
  config: AdapterConfig,
  native: string,
  tf: Timeframe,
): { page: Page; limit: number } {
  switch (exchange) {
    case "EXNESS":
      // Broker CFD prices are not public; MetaTrader chart data is not available to us yet. A 4xx
      // makes the trade's market analysis "unavailable" instead of retrying.
      return {
        limit: 1,
        page: async () => {
          throw new ExchangeHttpError(404, null, "Market data is not available for Exness yet");
        },
      };
    case "BINANCE": {
      const f = resolveFetch(config.binance ?? {});
      const base = config.binance?.futuresBaseUrl ?? "https://fapi.binance.com";
      return {
        limit: 1500,
        page: async (from, to) => {
          const rows = (await getJson(
            f,
            `${base}/fapi/v1/klines?symbol=${encodeURIComponent(native)}&interval=${tf}&startTime=${from}&endTime=${to}&limit=1500`,
          )) as unknown[][];
          return (rows ?? []).map((r) => ({
            t: num(r[0]),
            o: num(r[1]),
            h: num(r[2]),
            l: num(r[3]),
            c: num(r[4]),
            v: num(r[5]),
          }));
        },
      };
    }
    case "MEXC": {
      const f = resolveFetch(config.mexc ?? {});
      const base = config.mexc?.baseUrl ?? "https://api.mexc.com";
      const interval = { "5m": "Min5", "15m": "Min15", "1h": "Min60", "4h": "Hour4" }[tf];
      return {
        limit: 2000,
        page: async (from, to) => {
          const json = (await getJson(
            f,
            `${base}/api/v1/contract/kline/${encodeURIComponent(native)}?interval=${interval}&start=${Math.floor(from / 1000)}&end=${Math.floor(to / 1000)}`,
          )) as {
            success?: boolean;
            data?: {
              time?: number[];
              open?: number[];
              high?: number[];
              low?: number[];
              close?: number[];
              vol?: number[];
            };
          };
          if (json?.success === false)
            throw new ExchangeHttpError(400, null, "MEXC kline request rejected");
          const d = json?.data ?? {};
          return (d.time ?? []).map((t, i) => ({
            t: t * 1000,
            o: num(d.open?.[i]),
            h: num(d.high?.[i]),
            l: num(d.low?.[i]),
            c: num(d.close?.[i]),
            v: num(d.vol?.[i]),
          }));
        },
      };
    }
    case "KUCOIN": {
      const f = resolveFetch(config.kucoin ?? {});
      const base = config.kucoin?.futuresBaseUrl ?? "https://api-futures.kucoin.com";
      const granularity = { "5m": 5, "15m": 15, "1h": 60, "4h": 240 }[tf];
      return {
        limit: 500,
        page: async (from, to) => {
          const json = (await getJson(
            f,
            `${base}/api/v1/kline/query?symbol=${encodeURIComponent(native)}&granularity=${granularity}&from=${from}&to=${to}`,
          )) as { code?: string; data?: unknown[][] };
          if (json?.code && json.code !== "200000")
            throw new ExchangeHttpError(400, json.code, "KuCoin kline request rejected");
          return (json?.data ?? []).map((r) => ({
            t: num(r[0]),
            o: num(r[1]),
            h: num(r[2]),
            l: num(r[3]),
            c: num(r[4]),
            v: num(r[5]),
          }));
        },
      };
    }
    case "BYBIT": {
      const f = resolveFetch(config.bybit ?? {});
      const base = config.bybit?.baseUrl ?? "https://api.bybit.com";
      const interval = { "5m": "5", "15m": "15", "1h": "60", "4h": "240" }[tf];
      return {
        limit: 1000,
        page: async (from, to) => {
          const json = (await getJson(
            f,
            `${base}/v5/market/kline?category=linear&symbol=${encodeURIComponent(native)}&interval=${interval}&start=${from}&end=${to}&limit=1000`,
          )) as { retCode?: number; result?: { list?: string[][] } };
          if (json?.retCode !== undefined && json.retCode !== 0)
            throw new ExchangeHttpError(400, json.retCode, "Bybit kline request rejected");
          // Newest first; the caller sorts.
          return (json?.result?.list ?? []).map((r) => ({
            t: num(r[0]),
            o: num(r[1]),
            h: num(r[2]),
            l: num(r[3]),
            c: num(r[4]),
            v: num(r[5]),
          }));
        },
      };
    }
    case "OKX": {
      const f = resolveFetch(config.okx ?? {});
      const base = config.okx?.baseUrl ?? "https://www.okx.com";
      const bar = { "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H" }[tf];
      return {
        limit: 100,
        page: async (from, to) => {
          // `after` = older than, `before` = newer than (both exclusive), newest first.
          const json = (await getJson(
            f,
            `${base}/api/v5/market/history-candles?instId=${encodeURIComponent(native)}&bar=${bar}&after=${to + 1}&before=${from - 1}&limit=100`,
          )) as { code?: string; data?: string[][] };
          if (json?.code && json.code !== "0")
            throw new ExchangeHttpError(400, json.code, "OKX candle request rejected");
          return (json?.data ?? []).map((r) => ({
            t: num(r[0]),
            o: num(r[1]),
            h: num(r[2]),
            l: num(r[3]),
            c: num(r[4]),
            v: num(r[5]),
          }));
        },
      };
    }
    case "BINGX": {
      const f = resolveFetch(config.bingx ?? {});
      const base = config.bingx?.baseUrl ?? "https://open-api.bingx.com";
      return {
        limit: 1440,
        page: async (from, to) => {
          const json = (await getJson(
            f,
            `${base}/openApi/swap/v3/quote/klines?symbol=${encodeURIComponent(native)}&interval=${tf}&startTime=${from}&endTime=${to}&limit=1440`,
          )) as {
            code?: number;
            data?: {
              open: string;
              high: string;
              low: string;
              close: string;
              volume: string;
              time: number;
            }[];
          };
          if (json?.code && json.code !== 0)
            throw new ExchangeHttpError(400, json.code, "BingX kline request rejected");
          return (json?.data ?? []).map((r) => ({
            t: num(r.time),
            o: num(r.open),
            h: num(r.high),
            l: num(r.low),
            c: num(r.close),
            v: num(r.volume),
          }));
        },
      };
    }
  }
}

/**
 * Public candles for [from, to], oldest first, without duplicates. Pages forward until the range is
 * covered (bounded by MAX_PAGES). Uses the exchange where the trade happened, so candle prices match
 * the trader's fills.
 */
export async function fetchCandles(
  exchange: ExchangeId,
  config: AdapterConfig,
  native: string,
  tf: Timeframe,
  from: number,
  to: number,
): Promise<MarketCandle[]> {
  const { page, limit } = pager(exchange, config, native, tf);
  const step = TF_MS[tf];
  const byTime = new Map<number, MarketCandle>();
  let cursor = from;
  for (let i = 0; i < MAX_PAGES && cursor <= to; i++) {
    const end = Math.min(to, cursor + step * (limit - 1));
    const rows = (await page(cursor, end)).filter(
      (c) => Number.isFinite(c.t) && Number.isFinite(c.c),
    );
    for (const c of rows) if (c.t >= from && c.t <= to) byTime.set(c.t, c);
    const last = rows.reduce((m, c) => Math.max(m, c.t), -1);
    cursor = Math.max(end, last) + step;
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}
