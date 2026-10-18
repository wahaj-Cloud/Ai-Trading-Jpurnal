import type {
  BasisReading,
  FredSeriesId,
  LongShortReading,
  MacroSeriesDto,
  OptionsReading,
  StablecoinDto,
} from "@atc/shared";
import { FRED_LABEL } from "@atc/shared";
import { readCapped, resolveFetch } from "../http.js";
import { type ClientOptions, ExchangeHttpError, ExchangeNetworkError } from "../types.js";

/**
 * Public market readings for Trade Check, each from the source professionals use, with no API
 * keys except FRED's free one:
 *  - Binance futures: long/short ratios (all accounts, top traders) and the quarterly basis;
 *  - Coinbase vs Binance spot: the Coinbase premium;
 *  - Deribit: options open interest, max pain, 25-delta skew and the DVOL volatility index;
 *  - FRED (St. Louis Fed): the dollar, the 10-year yield, the S&P 500, the Nasdaq and the VIX;
 *  - DefiLlama: total stablecoin supply.
 * The parsers are pure and exported so every calculation is tested against known answers.
 */

export interface SourceOptions extends ClientOptions {
  baseUrl?: string;
}

const H = 3_600_000;
const DAY = 86_400_000;

async function getJson(
  o: ClientOptions,
  url: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const f = resolveFetch(o);
  let res: Response;
  try {
    res = await f(url, {
      headers: { Accept: "application/json", "User-Agent": "WickMentor/1.0", ...headers },
      redirect: "error",
      signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
    });
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

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Binance long/short ratios ───

export type LongShortKind = "accounts" | "topPositions";
const LS_PATH: Record<LongShortKind, string> = {
  accounts: "/futures/data/globalLongShortAccountRatio",
  topPositions: "/futures/data/topLongShortPositionRatio",
};

/** Hourly readings (oldest first) → the latest, its 24h change and its 20-day percentile. */
export function longShortReading(
  rows: ReadonlyArray<{ t: number; ratio: number; long: number; short: number }>,
): LongShortReading | null {
  const sorted = [...rows]
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.ratio) && r.ratio > 0)
    .sort((a, b) => a.t - b.t);
  const last = sorted.at(-1);
  if (!last) return null;
  // The reading closest to 24 hours earlier, if one is within 2 hours of it.
  let ref: (typeof sorted)[number] | null = null;
  for (const r of sorted) {
    if (Math.abs(r.t - (last.t - 24 * H)) <= 2 * H) {
      if (!ref || Math.abs(r.t - (last.t - 24 * H)) < Math.abs(ref.t - (last.t - 24 * H))) ref = r;
    }
  }
  const window = sorted.filter((r) => r.t > last.t - 20 * DAY);
  let percentile: number | null = null;
  if (window.length >= 120) {
    const below = window.filter((r) => r.ratio < last.ratio).length;
    const equal = window.filter((r) => r.ratio === last.ratio).length;
    percentile = ((below + 0.5 * equal) / window.length) * 100;
  }
  return {
    ratio: last.ratio,
    longShare: last.long,
    shortShare: last.short,
    change24h: ref ? last.ratio / ref.ratio - 1 : null,
    percentile,
    at: new Date(last.t).toISOString(),
  };
}

export async function fetchBinanceLongShort(
  o: SourceOptions,
  symbol: string,
  kind: LongShortKind,
): Promise<LongShortReading | null> {
  const base = o.baseUrl ?? "https://fapi.binance.com";
  const rows = (await getJson(
    o,
    `${base}${LS_PATH[kind]}?symbol=${encodeURIComponent(symbol)}&period=1h&limit=500`,
  )) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) throw new ExchangeHttpError(502, null, "Binance: no long/short data");
  return longShortReading(
    rows.map((r) => ({
      t: Number(r.timestamp),
      ratio: Number(r.longShortRatio),
      // The position-ratio endpoint uses the same field names as the account ratio.
      long: Number(r.longAccount ?? r.longPosition),
      short: Number(r.shortAccount ?? r.shortPosition),
    })),
  );
}

// ─── Binance quarterly basis ───

export interface DeliveryContract {
  symbol: string;
  pair: string;
  contractType: "CURRENT_QUARTER" | "NEXT_QUARTER";
  deliveryDate: number;
}

/** Quarterly futures that are trading (one exchangeInfo call serves every market). */
export async function fetchBinanceQuarterlies(o: SourceOptions): Promise<DeliveryContract[]> {
  const base = o.baseUrl ?? "https://fapi.binance.com";
  const info = (await getJson(o, `${base}/fapi/v1/exchangeInfo`)) as {
    symbols?: Array<Record<string, unknown>>;
  };
  return (info?.symbols ?? [])
    .filter(
      (s) =>
        (s.contractType === "CURRENT_QUARTER" || s.contractType === "NEXT_QUARTER") &&
        s.status === "TRADING",
    )
    .map((s) => ({
      symbol: String(s.symbol),
      pair: String(s.pair),
      contractType: s.contractType as DeliveryContract["contractType"],
      deliveryDate: Number(s.deliveryDate),
    }))
    .filter((s) => Number.isFinite(s.deliveryDate));
}

/** Basis from a quarterly's mark price and the index price. Annualised over the days left. */
export function basisReading(
  contract: DeliveryContract,
  mark: number,
  index: number,
  now: number,
): BasisReading | null {
  const days = (contract.deliveryDate - now) / DAY;
  if (!(mark > 0) || !(index > 0) || days <= 0) return null;
  const basisPct = (mark / index - 1) * 100;
  return {
    contract: contract.symbol,
    expiry: new Date(contract.deliveryDate).toISOString(),
    daysToExpiry: days,
    basisPct,
    annualizedPct: (basisPct * 365) / days,
  };
}

/**
 * The basis of the current quarter, or of the next one when the current quarter has under a week
 * left (a tiny premium annualised over a few days would exaggerate wildly).
 */
export async function fetchBinanceBasis(
  o: SourceOptions,
  contracts: readonly DeliveryContract[],
  pair: string,
  now: number,
): Promise<BasisReading | null> {
  const mine = contracts
    .filter((c) => c.pair === pair && c.deliveryDate - now >= 7 * DAY)
    .sort((a, b) => a.deliveryDate - b.deliveryDate);
  const c = mine[0];
  if (!c) return null;
  const base = o.baseUrl ?? "https://fapi.binance.com";
  const p = (await getJson(
    o,
    `${base}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(c.symbol)}`,
  )) as { markPrice?: string; indexPrice?: string };
  const mark = num(p?.markPrice);
  const index = num(p?.indexPrice);
  if (mark === null || index === null) return null;
  return basisReading(c, mark, index, now);
}

// ─── Coinbase premium ───

/** Coinbase USD price against Binance's USDT price converted to USD, in %. */
export function coinbasePremium(coinbaseUsd: number, binanceUsdt: number, usdtUsd: number) {
  if (!(coinbaseUsd > 0) || !(binanceUsdt > 0) || !(usdtUsd > 0)) return null;
  return (coinbaseUsd / (binanceUsdt * usdtUsd) - 1) * 100;
}

export async function fetchCoinbasePremium(
  o: { coinbase?: SourceOptions; binanceSpot?: SourceOptions },
  baseAsset: string,
): Promise<number | null> {
  const cb = o.coinbase ?? {};
  const bs = o.binanceSpot ?? {};
  const cbBase = cb.baseUrl ?? "https://api.exchange.coinbase.com";
  const bsBase = bs.baseUrl ?? "https://api.binance.com";
  const a = encodeURIComponent(baseAsset);
  const [coin, usdt, bin] = await Promise.all([
    getJson(cb, `${cbBase}/products/${a}-USD/ticker`) as Promise<{ price?: string }>,
    getJson(cb, `${cbBase}/products/USDT-USD/ticker`) as Promise<{ price?: string }>,
    getJson(bs, `${bsBase}/api/v3/ticker/price?symbol=${a}USDT`) as Promise<{ price?: string }>,
  ]);
  const c = num(coin?.price);
  const u = num(usdt?.price);
  const b = num(bin?.price);
  if (c === null || u === null || b === null) return null;
  return coinbasePremium(c, b, u);
}

// ─── Deribit options ───

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface DeribitOption {
  expiry: number;
  strike: number;
  kind: "C" | "P";
  /** Open interest in coins. */
  oi: number;
  /** Mark implied volatility, % a year. */
  iv: number | null;
  /** The forward (the expiry's underlying future) used for the implied volatility. */
  underlying: number | null;
}

/** "BTC-27DEC24-60000-C" → expiry (08:00 UTC), strike, kind. Strikes may use "d" for a point. */
export function parseDeribitInstrument(
  name: string,
): { expiry: number; strike: number; kind: "C" | "P" } | null {
  const m = /^[A-Z_]+-(\d{1,2})([A-Z]{3})(\d{2})-([\dd.]+)-([CP])$/.exec(name);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2] as string);
  if (month < 0) return null;
  const strike = Number((m[4] as string).replace("d", "."));
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return {
    expiry: Date.UTC(2000 + Number(m[3]), month, Number(m[1]), 8),
    strike,
    kind: m[5] as "C" | "P",
  };
}

/**
 * Standard normal cumulative distribution, Hart's double-precision algorithm (G. West, "Better
 * approximations to cumulative normal functions", 2005): accurate to about 1e-14.
 */
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let c: number;
  if (z > 37) c = 0;
  else {
    const e = Math.exp(-(z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      c = (e * n) / d;
    } else {
      let b = z + 0.65;
      b = z + 4 / b;
      b = z + 3 / b;
      b = z + 2 / b;
      b = z + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** Black-76 delta on the forward (Deribit quotes IV against the expiry's future). */
export function optionDelta(
  kind: "C" | "P",
  forward: number,
  strike: number,
  ivPct: number,
  years: number,
): number {
  const s = ivPct / 100;
  const d1 = (Math.log(forward / strike) + 0.5 * s * s * years) / (s * Math.sqrt(years));
  return kind === "C" ? normCdf(d1) : normCdf(d1) - 1;
}

/** Linear interpolation of IV at a target delta from (delta, iv) points; null if not bracketed. */
function ivAtDelta(points: Array<{ delta: number; iv: number }>, target: number): number | null {
  const sorted = [...points].sort((a, b) => a.delta - b.delta);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as { delta: number; iv: number };
    const b = sorted[i] as { delta: number; iv: number };
    if (a.delta <= target && target <= b.delta) {
      if (b.delta === a.delta) return (a.iv + b.iv) / 2;
      return a.iv + ((target - a.delta) / (b.delta - a.delta)) * (b.iv - a.iv);
    }
  }
  return null;
}

/** Strike that minimises what the expiry's options pay their holders. */
export function maxPain(options: readonly DeribitOption[]): number | null {
  const strikes = [...new Set(options.map((o) => o.strike))].sort((a, b) => a - b);
  let best: number | null = null;
  let bestPain = Number.POSITIVE_INFINITY;
  for (const k of strikes) {
    let pain = 0;
    for (const o of options) {
      pain += o.kind === "C" ? o.oi * Math.max(0, k - o.strike) : o.oi * Math.max(0, o.strike - k);
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = k;
    }
  }
  return best;
}

/** Put/call ratio, max pain of the biggest expiry within 30 days and 25-delta skew near 30 days. */
export function optionsReading(
  currency: "BTC" | "ETH",
  options: readonly DeribitOption[],
  now: number,
  dvol: { value: number | null; change24h: number | null },
): OptionsReading | null {
  const live = options.filter((o) => o.expiry > now);
  if (live.length === 0) return null;
  const callOi = live.filter((o) => o.kind === "C").reduce((s, o) => s + o.oi, 0);
  const putOi = live.filter((o) => o.kind === "P").reduce((s, o) => s + o.oi, 0);
  if (callOi <= 0) return null;
  const totalOi = callOi + putOi;

  const byExpiry = new Map<number, DeribitOption[]>();
  for (const o of live) byExpiry.set(o.expiry, [...(byExpiry.get(o.expiry) ?? []), o]);
  const expiries = [...byExpiry.keys()].sort((a, b) => a - b);
  const sumOi = (e: number) => (byExpiry.get(e) ?? []).reduce((s, o) => s + o.oi, 0);
  const within = expiries.filter((e) => e - now <= 30 * DAY);
  const pool = within.length > 0 ? within : expiries.slice(0, 1);
  const main = pool.reduce((a, b) => (sumOi(b) > sumOi(a) ? b : a));
  const pain = maxPain(byExpiry.get(main) ?? []);
  if (pain === null) return null;

  // Skew at the expiry closest to 30 days among those at least 7 days away.
  const far = expiries.filter((e) => e - now >= 7 * DAY);
  let skew: number | null = null;
  let skewExpiry: number | null = null;
  if (far.length > 0) {
    const e = far.reduce((a, b) =>
      Math.abs(b - now - 30 * DAY) < Math.abs(a - now - 30 * DAY) ? b : a,
    );
    const years = (e - now) / (365 * DAY);
    const pts = (kind: "C" | "P") =>
      (byExpiry.get(e) ?? [])
        .filter((o) => o.kind === kind && o.iv !== null && o.iv > 0 && (o.underlying ?? 0) > 0)
        .map((o) => ({
          delta: optionDelta(kind, o.underlying as number, o.strike, o.iv as number, years),
          iv: o.iv as number,
        }));
    const call = ivAtDelta(pts("C"), 0.25);
    const put = ivAtDelta(pts("P"), -0.25);
    if (call !== null && put !== null) {
      skew = put - call;
      skewExpiry = e;
    }
  }
  const underlying =
    (byExpiry.get(main) ?? []).find((o) => (o.underlying ?? 0) > 0)?.underlying ?? 0;
  return {
    currency,
    dvol: dvol.value,
    dvolChange24h: dvol.change24h,
    putCallOi: putOi / callOi,
    expiry: new Date(main).toISOString(),
    expiryOiShare: sumOi(main) / totalOi,
    maxPain: pain,
    skew25d: skew,
    skewExpiry: skewExpiry !== null ? new Date(skewExpiry).toISOString() : null,
    underlying,
  };
}

/** DVOL candles [t, open, high, low, close] → latest close and the change vs 24 hours earlier. */
export function dvolReading(candles: ReadonlyArray<ReadonlyArray<number>>): {
  value: number | null;
  change24h: number | null;
} {
  const rows = candles
    .map((c) => ({ t: Number(c[0]), v: Number(c[4]) }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.v) && c.v > 0)
    .sort((a, b) => a.t - b.t);
  const last = rows.at(-1);
  if (!last) return { value: null, change24h: null };
  // DVOL is quoted in volatility points (e.g. 52.3); guard against a fractional quote (0.523).
  const scale = last.v < 5 ? 100 : 1;
  // The reading closest to 24 hours before the latest one (within an hour of it).
  const target = last.t - 24 * H;
  const ref = rows
    .filter((r) => Math.abs(r.t - target) <= H)
    .sort((a, b) => Math.abs(a.t - target) - Math.abs(b.t - target))[0];
  return {
    value: last.v * scale,
    change24h: ref ? (last.v - ref.v) * scale : null,
  };
}

export async function fetchDeribitOptions(
  o: SourceOptions,
  currency: "BTC" | "ETH",
  now: number,
): Promise<OptionsReading | null> {
  const base = o.baseUrl ?? "https://www.deribit.com/api/v2";
  const [book, vol] = await Promise.all([
    getJson(
      o,
      `${base}/public/get_book_summary_by_currency?currency=${currency}&kind=option`,
    ) as Promise<{ result?: Array<Record<string, unknown>> }>,
    (
      getJson(
        o,
        `${base}/public/get_volatility_index_data?currency=${currency}&start_timestamp=${now - 27 * H}&end_timestamp=${now}&resolution=3600`,
      ) as Promise<{ result?: { data?: number[][] } }>
    ).catch(() => null),
  ]);
  if (!Array.isArray(book?.result)) throw new ExchangeHttpError(502, null, "Deribit: no options");
  const options: DeribitOption[] = [];
  for (const r of book.result) {
    const p = parseDeribitInstrument(String(r.instrument_name ?? ""));
    const oi = num(r.open_interest);
    if (!p || oi === null || oi < 0) continue;
    options.push({ ...p, oi, iv: num(r.mark_iv), underlying: num(r.underlying_price) });
  }
  return optionsReading(currency, options, now, dvolReading(vol?.result?.data ?? []));
}

// ─── FRED (St. Louis Fed) ───

/** Observations (newest first or any order) → latest value and its change over one week. */
export function fredReading(
  id: FredSeriesId,
  observations: ReadonlyArray<{ date: string; value: string }>,
): MacroSeriesDto | null {
  const rows = observations
    .filter((r) => r.value !== "." && Number.isFinite(Number(r.value)))
    .map((r) => ({ date: r.date, t: Date.parse(`${r.date}T00:00:00Z`), v: Number(r.value) }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => b.t - a.t);
  const last = rows[0];
  if (!last) return null;
  // The latest close at least 7 days before the latest one (a week of trading).
  const ref = rows.find((r) => r.t <= last.t - 7 * DAY && r.t >= last.t - 12 * DAY);
  return {
    id,
    label: FRED_LABEL[id],
    value: last.v,
    date: last.date,
    change: ref ? last.v - ref.v : null,
    changePct: ref && ref.v !== 0 ? (last.v / ref.v - 1) * 100 : null,
  };
}

export async function fetchFredSeries(
  o: SourceOptions & { apiKey: string },
  id: FredSeriesId,
): Promise<MacroSeriesDto | null> {
  const base = o.baseUrl ?? "https://api.stlouisfed.org";
  const q = new URLSearchParams({
    series_id: id,
    api_key: o.apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: "30",
  });
  const body = (await getJson(o, `${base}/fred/series/observations?${q}`)) as {
    observations?: Array<{ date: string; value: string }>;
  };
  if (!Array.isArray(body?.observations))
    throw new ExchangeHttpError(502, null, `FRED: no observations for ${id}`);
  return fredReading(id, body.observations);
}

// ─── DefiLlama stablecoins ───

/** Daily totals → latest supply and its change over 7 and 30 days. */
export function stablecoinReading(
  rows: ReadonlyArray<Record<string, unknown>>,
  now: number,
): StablecoinDto | null {
  const points = rows
    .map((r) => {
      const t = Number(r.date) * 1000;
      const pegs = (r.totalCirculatingUSD ?? r.totalCirculating) as
        | Record<string, unknown>
        | undefined;
      const total = pegs ? Object.values(pegs).reduce<number>((s, v) => s + (num(v) ?? 0), 0) : 0;
      return { t, total };
    })
    .filter((p) => Number.isFinite(p.t) && p.total > 0)
    .sort((a, b) => a.t - b.t);
  const last = points.at(-1);
  if (!last) return null;
  const back = (days: number) => {
    const target = last.t - days * DAY;
    const hit = points.find((p) => Math.abs(p.t - target) <= DAY / 2);
    return hit ? (last.total / hit.total - 1) * 100 : null;
  };
  return {
    totalUsd: last.total,
    change7dPct: back(7),
    change30dPct: back(30),
    date: new Date(last.t).toISOString().slice(0, 10),
    updatedAt: new Date(now).toISOString(),
  };
}

export async function fetchStablecoinSupply(
  o: SourceOptions,
  now: number,
): Promise<StablecoinDto | null> {
  const base = o.baseUrl ?? "https://stablecoins.llama.fi";
  const rows = await getJson(o, `${base}/stablecoincharts/all`);
  if (!Array.isArray(rows)) throw new ExchangeHttpError(502, null, "DefiLlama: no stablecoin data");
  return stablecoinReading(rows as Array<Record<string, unknown>>, now);
}
