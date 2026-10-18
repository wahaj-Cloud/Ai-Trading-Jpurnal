import { readCapped, resolveFetch } from "../http.js";
import { type ClientOptions, ExchangeHttpError, ExchangeNetworkError } from "../types.js";

/**
 * CoinMarketCap market overview: total market cap, the CMC Fear & Greed Index and the Altcoin
 * Season Index. Works without a key through CMC's keyless public route; with a (free Basic) key the
 * same endpoints are called on the keyed route, which also unlocks market-cap history.
 */

export interface CmcOptions extends ClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface CmcGlobal {
  totalMarketCapUsd: number;
  totalVolume24hUsd: number | null;
  btcDominance: number | null;
  /** % change of total market cap vs 24 hours ago, when CMC reports it. */
  change24hPct: number | null;
  updatedAt: string;
}

export interface CmcFearGreed {
  value: number;
  /** "Extreme fear", "Fear", "Neutral", "Greed", "Extreme greed". */
  label: string;
  updatedAt: string;
}

export interface CmcAltcoinSeason {
  /** 0 = Bitcoin season … 100 = Altcoin season. */
  value: number;
  updatedAt: string;
}

export interface CmcMarketCapPoint {
  t: number;
  usd: number;
}

async function cmcGet<T>(
  o: CmcOptions,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const host = o.baseUrl ?? "https://pro-api.coinmarketcap.com";
  const prefix = o.apiKey ? "" : "/public-api";
  const query = new URLSearchParams(params).toString();
  const f = resolveFetch(o);
  let res: Response;
  try {
    res = await f(`${host}${prefix}${path}${query ? `?${query}` : ""}`, {
      headers: {
        Accept: "application/json",
        ...(o.apiKey ? { "X-CMC_PRO_API_KEY": o.apiKey } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ExchangeNetworkError(err);
  }
  const text = await readCapped(res);
  let json: {
    data?: unknown;
    status?: { error_code?: number | string; error_message?: string | null };
  } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // handled below
  }
  const code = Number(json?.status?.error_code ?? 0);
  if (!res.ok || !json || code !== 0) {
    throw new ExchangeHttpError(
      res.status,
      Number.isFinite(code) && code !== 0 ? code : null,
      json?.status?.error_message ?? text.slice(0, 200),
    );
  }
  return json.data as T;
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function fetchCmcGlobal(o: CmcOptions = {}): Promise<CmcGlobal> {
  const d = await cmcGet<{
    btc_dominance?: number;
    last_updated?: string;
    quote?: {
      USD?: {
        total_market_cap?: number;
        total_volume_24h?: number;
        total_market_cap_yesterday_percentage_change?: number;
        last_updated?: string;
      };
    };
  }>(o, "/v1/global-metrics/quotes/latest");
  const usd = d?.quote?.USD;
  const cap = n(usd?.total_market_cap);
  if (cap === null || cap <= 0)
    throw new ExchangeHttpError(502, null, "CoinMarketCap: no market cap");
  return {
    totalMarketCapUsd: cap,
    totalVolume24hUsd: n(usd?.total_volume_24h),
    btcDominance: n(d?.btc_dominance),
    change24hPct: n(usd?.total_market_cap_yesterday_percentage_change),
    updatedAt: usd?.last_updated ?? d?.last_updated ?? new Date().toISOString(),
  };
}

export async function fetchCmcFearGreed(o: CmcOptions = {}): Promise<CmcFearGreed> {
  const d = await cmcGet<{ value?: number; value_classification?: string; update_time?: string }>(
    o,
    "/v3/fear-and-greed/latest",
  );
  const value = n(d?.value);
  if (value === null)
    throw new ExchangeHttpError(502, null, "CoinMarketCap: no fear & greed value");
  return {
    value,
    label: d?.value_classification ?? "",
    updatedAt: d?.update_time ?? new Date().toISOString(),
  };
}

export async function fetchCmcAltcoinSeason(o: CmcOptions = {}): Promise<CmcAltcoinSeason> {
  const d = await cmcGet<{ altcoin_index?: number; snapshot_time?: string }>(
    o,
    "/v1/altcoin-season-index/latest",
  );
  const value = n(d?.altcoin_index);
  if (value === null) throw new ExchangeHttpError(502, null, "CoinMarketCap: no altcoin index");
  return { value, updatedAt: d?.snapshot_time ?? new Date().toISOString() };
}

/** Hourly total market cap (keyed route only), for the 7-day sparkline on a fresh install. */
export async function fetchCmcMarketCapHistory(
  o: CmcOptions & { apiKey: string },
  from: number,
  to: number,
): Promise<CmcMarketCapPoint[]> {
  const d = await cmcGet<{
    quotes?: Array<{ timestamp?: string; quote?: { USD?: { total_market_cap?: number } } }>;
  }>(o, "/v1/global-metrics/quotes/historical", {
    time_start: new Date(from).toISOString(),
    time_end: new Date(to).toISOString(),
    interval: "1h",
    count: "200",
  });
  return (d?.quotes ?? []).flatMap((q) => {
    const t = Date.parse(q.timestamp ?? "");
    const usd = n(q.quote?.USD?.total_market_cap);
    return Number.isFinite(t) && usd !== null ? [{ t, usd }] : [];
  });
}
