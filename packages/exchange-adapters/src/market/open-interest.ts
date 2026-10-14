import { readCapped, resolveFetch } from "../http.js";
import { type ClientOptions, ExchangeHttpError, ExchangeNetworkError } from "../types.js";

/**
 * Public open-interest history from Binance, Bybit and OKX (no API keys), in base-coin units, and
 * Binance candles with taker-buy volume. Inputs for the estimated liquidation map.
 */

export type OiPeriod = "5m" | "1h";

/** One open-interest reading: time (ms) and contracts outstanding, in coins. */
export interface OiPoint {
  t: number;
  oi: number;
}

/** A candle with the share of its volume bought by takers (aggressive buyers), 0..1. */
export interface FlowCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  takerBuyShare: number | null;
}

export interface PublicMarketOptions {
  binance?: ClientOptions & { futuresBaseUrl?: string };
  bybit?: ClientOptions & { baseUrl?: string };
  okx?: ClientOptions & { baseUrl?: string };
}

const PERIOD_MS: Record<OiPeriod, number> = { "5m": 300_000, "1h": 3_600_000 };

async function getJson(o: ClientOptions, url: string): Promise<unknown> {
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

const finite = (p: OiPoint) => Number.isFinite(p.t) && Number.isFinite(p.oi) && p.oi >= 0;
const sortUnique = (rows: OiPoint[]): OiPoint[] =>
  [...new Map(rows.filter(finite).map((r) => [r.t, r])).values()].sort((a, b) => a.t - b.t);

/** Binance USDⓈ-M: /futures/data/openInterestHist (last 30 days, 500 rows per call). */
export async function fetchBinanceOpenInterest(
  symbol: string,
  period: OiPeriod,
  from: number,
  to: number,
  o: PublicMarketOptions["binance"] = {},
): Promise<OiPoint[]> {
  const base = o.futuresBaseUrl ?? "https://fapi.binance.com";
  const out: OiPoint[] = [];
  for (let start = from, i = 0; start <= to && i < 10; i++) {
    const rows = (await getJson(
      o,
      `${base}/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=${period}&startTime=${start}&endTime=${to}&limit=500`,
    )) as Array<{ sumOpenInterest: string; timestamp: number }> | null;
    const page = (rows ?? []).map((r) => ({
      t: Number(r.timestamp),
      oi: Number(r.sumOpenInterest),
    }));
    out.push(...page);
    if (page.length < 500) break;
    start = Math.max(...page.map((p) => p.t)) + 1;
  }
  return sortUnique(out);
}

/** Bybit linear: /v5/market/open-interest (200 rows per page, newest first, cursor paging). */
export async function fetchBybitOpenInterest(
  symbol: string,
  period: OiPeriod,
  from: number,
  to: number,
  o: PublicMarketOptions["bybit"] = {},
): Promise<OiPoint[]> {
  const base = o.baseUrl ?? "https://api.bybit.com";
  const interval = period === "5m" ? "5min" : "1h";
  const out: OiPoint[] = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const json = (await getJson(
      o,
      `${base}/v5/market/open-interest?category=linear&symbol=${encodeURIComponent(symbol)}&intervalTime=${interval}&startTime=${from}&endTime=${to}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    )) as {
      retCode?: number;
      retMsg?: string;
      result?: {
        list?: Array<{ openInterest: string; timestamp: string }>;
        nextPageCursor?: string;
      };
    } | null;
    if (json?.retCode !== undefined && json.retCode !== 0) {
      throw new ExchangeHttpError(400, json.retCode, json.retMsg ?? "Bybit open interest rejected");
    }
    const list = json?.result?.list ?? [];
    out.push(...list.map((r) => ({ t: Number(r.timestamp), oi: Number(r.openInterest) })));
    cursor = json?.result?.nextPageCursor ?? "";
    if (!cursor || list.length === 0) break;
  }
  return sortUnique(out);
}

/**
 * OKX swaps: /api/v5/rubik/stat/contracts/open-interest-history, rows [ts, oi, oiCcy, oiUsd],
 * newest first, 100 per call; `begin`/`end` are exclusive. oiCcy is already in coins.
 */
export async function fetchOkxOpenInterest(
  instId: string,
  period: OiPeriod,
  from: number,
  to: number,
  o: PublicMarketOptions["okx"] = {},
): Promise<OiPoint[]> {
  const base = o.baseUrl ?? "https://www.okx.com";
  const bar = period === "5m" ? "5m" : "1H";
  const out: OiPoint[] = [];
  let end = to + 1;
  for (let i = 0; i < 10 && end > from; i++) {
    const json = (await getJson(
      o,
      `${base}/api/v5/rubik/stat/contracts/open-interest-history?instId=${encodeURIComponent(instId)}&period=${bar}&begin=${from - 1}&end=${end}&limit=100`,
    )) as { code?: string; msg?: string; data?: string[][] } | null;
    if (json?.code && json.code !== "0") {
      throw new ExchangeHttpError(400, json.code, json.msg ?? "OKX open interest rejected");
    }
    const rows = (json?.data ?? []).map((r) => ({ t: Number(r[0]), oi: Number(r[2]) }));
    out.push(...rows);
    if (rows.length < 100) break;
    end = Math.min(...rows.map((r) => r.t));
  }
  return sortUnique(out).filter((p) => p.t >= from && p.t <= to);
}

/** Binance candles with taker-buy volume (who was aggressive in each candle). */
export async function fetchBinanceFlowCandles(
  symbol: string,
  period: OiPeriod,
  from: number,
  to: number,
  o: PublicMarketOptions["binance"] = {},
): Promise<FlowCandle[]> {
  const base = o.futuresBaseUrl ?? "https://fapi.binance.com";
  const out: FlowCandle[] = [];
  for (let start = from, i = 0; start <= to && i < 10; i++) {
    const rows = (await getJson(
      o,
      `${base}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${period}&startTime=${start}&endTime=${to}&limit=1000`,
    )) as unknown[][] | null;
    const page = (rows ?? []).map((r) => {
      const v = Number(r[5]);
      const takerBuy = Number(r[9]);
      return {
        t: Number(r[0]),
        o: Number(r[1]),
        h: Number(r[2]),
        l: Number(r[3]),
        c: Number(r[4]),
        v,
        takerBuyShare:
          v > 0 && Number.isFinite(takerBuy) ? Math.min(1, Math.max(0, takerBuy / v)) : null,
      };
    });
    out.push(...page);
    if (page.length < 1000) break;
    start = (page.at(-1)?.t ?? to) + PERIOD_MS[period];
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t);
}

export const OI_PERIOD_MS = PERIOD_MS;
