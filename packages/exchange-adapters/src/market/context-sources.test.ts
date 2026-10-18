import { describe, expect, it } from "vitest";
import { fakeExchange } from "../test-utils.js";
import {
  basisReading,
  coinbasePremium,
  type DeribitOption,
  dvolReading,
  fetchBinanceBasis,
  fetchBinanceLongShort,
  fetchCoinbasePremium,
  fetchDeribitOptions,
  fetchFredSeries,
  fetchStablecoinSupply,
  fredReading,
  longShortReading,
  maxPain,
  normCdf,
  optionDelta,
  optionsReading,
  parseDeribitInstrument,
} from "./context-sources.js";

const H = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 17, 12);

describe("normal distribution and delta", () => {
  it("matches reference values of N(x)", () => {
    // Values from standard normal tables.
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(0.25)).toBeCloseTo(0.598706, 5);
    expect(normCdf(1)).toBeCloseTo(0.841345, 5);
    expect(normCdf(-1.96)).toBeCloseTo(0.024998, 5);
    expect(normCdf(-0.6745)).toBeCloseTo(0.25, 4);
    // Double precision: far tails and symmetry.
    expect(normCdf(-5)).toBeCloseTo(2.866515718791933e-7, 15);
    expect(normCdf(0.3) + normCdf(-0.3)).toBeCloseTo(1, 14);
    expect(normCdf(1.2345678)).toBeCloseTo(0.891504300472242, 12); // scipy.stats.norm.cdf
  });
  it("gives the Black-76 delta of calls and puts", () => {
    // F = K = 100, 50% vol, 1 year: d1 = 0.25.
    expect(optionDelta("C", 100, 100, 50, 1)).toBeCloseTo(0.598706, 5);
    expect(optionDelta("P", 100, 100, 50, 1)).toBeCloseTo(-0.401294, 5);
    // Put-call delta parity on a forward: call − put = 1.
    const c = optionDelta("C", 61000, 70000, 48, 30 / 365);
    const p = optionDelta("P", 61000, 70000, 48, 30 / 365);
    expect(c - p).toBeCloseTo(1, 10);
  });
});

describe("Deribit options", () => {
  it("parses instrument names, including decimal strikes", () => {
    expect(parseDeribitInstrument("BTC-27DEC24-60000-C")).toEqual({
      expiry: Date.UTC(2024, 11, 27, 8),
      strike: 60000,
      kind: "C",
    });
    expect(parseDeribitInstrument("XRP_USDC-7NOV26-0d625-P")?.strike).toBe(0.625);
    expect(parseDeribitInstrument("BTC-PERPETUAL")).toBeNull();
    expect(parseDeribitInstrument("BTC-27XYZ24-60000-C")).toBeNull();
  });

  it("finds max pain by brute force over strikes", () => {
    const e = NOW + 2 * DAY;
    const opt = (strike: number, kind: "C" | "P", oi: number): DeribitOption => ({
      expiry: e,
      strike,
      kind,
      oi,
      iv: null,
      underlying: null,
    });
    const book = [
      opt(90, "C", 10),
      opt(100, "C", 30),
      opt(110, "C", 50),
      opt(90, "P", 60),
      opt(100, "P", 20),
      opt(110, "P", 5),
    ];
    // Payout at 90: calls 0; puts 20×10 + 5×20 = 300.
    // At 100: calls 10×10 = 100; puts 5×10 = 50 → 150.
    // At 110: calls 10×20 + 30×10 = 500; puts 0 → 500.
    expect(maxPain(book)).toBe(100);
  });

  it("computes put/call, the main expiry and a 25-delta skew that matches an independent solve", () => {
    const e1 = NOW + 2 * DAY; // small
    const e2 = NOW + 9 * DAY; // biggest within 30 days
    const e3 = NOW + 29 * DAY; // closest to 30 days: used for the skew
    const F = 60000;
    const book: DeribitOption[] = [];
    for (const k of [50000, 54000, 58000, 60000, 62000, 66000, 70000]) {
      // A smile: puts (low strikes) carry more volatility.
      const iv = 50 + (60000 - k) / 1000;
      book.push({ expiry: e3, strike: k, kind: "C", oi: 10, iv, underlying: F });
      book.push({ expiry: e3, strike: k, kind: "P", oi: 8, iv, underlying: F });
    }
    book.push({ expiry: e1, strike: 60000, kind: "C", oi: 5, iv: 40, underlying: F });
    book.push({ expiry: e2, strike: 60000, kind: "C", oi: 300, iv: 45, underlying: F });
    book.push({ expiry: e2, strike: 58000, kind: "P", oi: 200, iv: 47, underlying: F });
    const r = optionsReading("BTC", book, NOW, { value: 52, change24h: 3 });
    expect(r).not.toBeNull();
    if (!r) return;
    const calls = 7 * 10 + 5 + 300;
    const puts = 7 * 8 + 200;
    expect(r.putCallOi).toBeCloseTo(puts / calls, 12);
    expect(r.expiry).toBe(new Date(e2).toISOString());
    expect(r.expiryOiShare).toBeCloseTo(500 / (calls + puts), 12);
    expect(r.skewExpiry).toBe(new Date(e3).toISOString());

    // Independent check: on this smile IV = 50 + (60000 − K)/1000, solve for the strike whose
    // delta is exactly ±0.25 by bisection, then read the smile there.
    const T = 29 / 365;
    const ivOf = (k: number) => 50 + (60000 - k) / 1000;
    const solve = (kind: "C" | "P", target: number) => {
      let lo = 40000;
      let hi = 90000;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        const d = optionDelta(kind, F, mid, ivOf(mid), T);
        // Delta falls as the strike rises, for calls and puts alike.
        if (d > target) lo = mid;
        else hi = mid;
      }
      return ivOf((lo + hi) / 2);
    };
    const exact = solve("P", -0.25) - solve("C", 0.25);
    // Linear interpolation between listed strikes stays within a fraction of a vol point.
    expect(r.skew25d).not.toBeNull();
    expect(Math.abs((r.skew25d as number) - exact)).toBeLessThan(0.3);
    expect(r.skew25d as number).toBeGreaterThan(0);
  });

  it("reads DVOL and its 24h change, scaling a fractional quote", () => {
    const c = (t: number, v: number) => [t, v, v, v, v];
    expect(dvolReading([c(NOW - 24 * H, 50), c(NOW - H, 54), c(NOW, 55.5)])).toEqual({
      value: 55.5,
      change24h: 5.5,
    });
    expect(dvolReading([c(NOW, 0.52)]).value).toBeCloseTo(52, 10);
    expect(dvolReading([])).toEqual({ value: null, change24h: null });
  });

  it("calls Deribit's public endpoints and parses the documented fields", async () => {
    const ex = fakeExchange((url) => {
      if (url.pathname.endsWith("/public/get_book_summary_by_currency"))
        return {
          body: {
            jsonrpc: "2.0",
            result: [
              {
                instrument_name: "BTC-30OCT26-60000-C",
                open_interest: 120.5,
                mark_iv: 48.2,
                underlying_price: 60100,
              },
              {
                instrument_name: "BTC-30OCT26-60000-P",
                open_interest: 80,
                mark_iv: 49.1,
                underlying_price: 60100,
              },
              { instrument_name: "BTC-PERPETUAL", open_interest: 1e9 },
            ],
          },
        };
      if (url.pathname.endsWith("/public/get_volatility_index_data"))
        return { body: { jsonrpc: "2.0", result: { data: [[NOW, 50, 51, 49, 50.7]] } } };
      return undefined;
    });
    const r = await fetchDeribitOptions({ fetch: ex.fetch }, "BTC", NOW);
    expect(r?.putCallOi).toBeCloseTo(80 / 120.5, 12);
    expect(r?.maxPain).toBe(60000);
    expect(r?.dvol).toBe(50.7);
    const q = ex.requests[0]?.url;
    expect(q?.searchParams.get("kind")).toBe("option");
    expect(q?.host).toBe("www.deribit.com");
    expect(ex.requests[1]?.url.searchParams.get("resolution")).toBe("3600");
  });
});

describe("Binance long/short ratios", () => {
  const series = (n: number, f: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => {
      const ratio = f(i);
      const long = ratio / (1 + ratio);
      return { t: NOW - (n - 1 - i) * H, ratio, long, short: 1 - long };
    });

  it("gives the 24h change and the 20-day percentile", () => {
    const rows = series(480, (i) => 1 + (i % 100) / 100);
    const r = longShortReading(rows);
    const last = rows.at(-1)?.ratio as number;
    const dayAgo = rows.at(-25)?.ratio as number;
    expect(r?.ratio).toBe(last);
    expect(r?.change24h).toBeCloseTo(last / dayAgo - 1, 12);
    // Independent percentile: share strictly below plus half the ties.
    const below = rows.filter((x) => x.ratio < last).length;
    const eq = rows.filter((x) => x.ratio === last).length;
    expect(r?.percentile).toBeCloseTo(((below + eq / 2) / rows.length) * 100, 10);
  });

  it("leaves the percentile out with under 5 days of history", () => {
    expect(longShortReading(series(100, () => 1.2))?.percentile).toBeNull();
    expect(longShortReading([])).toBeNull();
  });

  it("reads the documented response of both endpoints", async () => {
    const ex = fakeExchange((url) => {
      if (
        url.pathname === "/futures/data/globalLongShortAccountRatio" ||
        url.pathname === "/futures/data/topLongShortPositionRatio"
      )
        return {
          body: [
            {
              symbol: "BTCUSDT",
              longShortRatio: "1.8000",
              longAccount: "0.6429",
              shortAccount: "0.3571",
              timestamp: NOW - H,
            },
            {
              symbol: "BTCUSDT",
              longShortRatio: "2.0000",
              longAccount: "0.6667",
              shortAccount: "0.3333",
              timestamp: String(NOW),
            },
          ],
        };
      return undefined;
    });
    const a = await fetchBinanceLongShort({ fetch: ex.fetch }, "BTCUSDT", "accounts");
    const t = await fetchBinanceLongShort({ fetch: ex.fetch }, "BTCUSDT", "topPositions");
    expect(a).toMatchObject({ ratio: 2, longShare: 0.6667, shortShare: 0.3333 });
    expect(t?.ratio).toBe(2);
    expect(ex.requests[0]?.url.searchParams.get("period")).toBe("1h");
    expect(ex.requests[0]?.url.searchParams.get("limit")).toBe("500");
  });
});

describe("Quarterly basis", () => {
  it("annualises the premium over the days left", () => {
    const c = {
      symbol: "BTCUSDT_261225",
      pair: "BTCUSDT",
      contractType: "CURRENT_QUARTER" as const,
      deliveryDate: NOW + 73 * DAY,
    };
    const r = basisReading(c, 61200, 60000, NOW);
    expect(r?.basisPct).toBeCloseTo(2, 10);
    expect(r?.annualizedPct).toBeCloseTo((2 * 365) / 73, 10);
  });

  it("skips a quarter with under a week left and uses the next one", async () => {
    const ex = fakeExchange((url) =>
      url.pathname === "/fapi/v1/premiumIndex"
        ? {
            body: {
              symbol: url.searchParams.get("symbol"),
              markPrice: "60600",
              indexPrice: "60000",
            },
          }
        : undefined,
    );
    const contracts = [
      {
        symbol: "BTCUSDT_261023",
        pair: "BTCUSDT",
        contractType: "CURRENT_QUARTER" as const,
        deliveryDate: NOW + 3 * DAY,
      },
      {
        symbol: "BTCUSDT_261225",
        pair: "BTCUSDT",
        contractType: "NEXT_QUARTER" as const,
        deliveryDate: NOW + 70 * DAY,
      },
    ];
    const r = await fetchBinanceBasis({ fetch: ex.fetch }, contracts, "BTCUSDT", NOW);
    expect(r?.contract).toBe("BTCUSDT_261225");
    expect(r?.annualizedPct).toBeCloseTo((1 * 365) / 70, 10);
    expect(await fetchBinanceBasis({ fetch: ex.fetch }, contracts, "SOLUSDT", NOW)).toBeNull();
  });
});

describe("Coinbase premium", () => {
  it("adjusts Binance's USDT price by USDT's own dollar price", () => {
    // Coinbase $60,060; Binance 60,000 USDT at $1.0005 = $60,030 → +0.04998%.
    expect(coinbasePremium(60060, 60000, 1.0005)).toBeCloseTo((60060 / 60030 - 1) * 100, 12);
    expect(coinbasePremium(0, 1, 1)).toBeNull();
  });
  it("reads both tickers", async () => {
    const ex = fakeExchange((url) => {
      if (url.pathname === "/products/BTC-USD/ticker") return { body: { price: "60100.00" } };
      if (url.pathname === "/products/USDT-USD/ticker") return { body: { price: "0.99980" } };
      if (url.pathname === "/api/v3/ticker/price")
        return { body: { symbol: "BTCUSDT", price: "60050.10" } };
      return undefined;
    });
    const p = await fetchCoinbasePremium(
      { coinbase: { fetch: ex.fetch }, binanceSpot: { fetch: ex.fetch } },
      "BTC",
    );
    expect(p).toBeCloseTo((60100 / (60050.1 * 0.9998) - 1) * 100, 10);
    expect(ex.requests.find((r) => r.url.pathname.includes("BTC-USD"))?.url.host).toBe(
      "api.exchange.coinbase.com",
    );
    // Coinbase refuses requests without a User-Agent.
    expect(ex.requests[0]?.headers["User-Agent"]).toBeTruthy();
  });
});

describe("FRED", () => {
  it("compares the latest close with the close a week earlier, skipping blanks", () => {
    const obs = [
      { date: "2026-10-16", value: "4.12" },
      { date: "2026-10-15", value: "." },
      { date: "2026-10-14", value: "4.05" },
      { date: "2026-10-09", value: "3.98" },
      { date: "2026-10-08", value: "3.90" },
    ];
    const r = fredReading("DGS10", obs);
    expect(r).toMatchObject({ value: 4.12, date: "2026-10-16" });
    expect(r?.change).toBeCloseTo(4.12 - 3.98, 12);
    expect(r?.changePct).toBeCloseTo((4.12 / 3.98 - 1) * 100, 12);
  });
  it("sends the key as a parameter and reads observations", async () => {
    const ex = fakeExchange((url) =>
      url.pathname === "/fred/series/observations"
        ? {
            body: {
              observations: [
                { realtime_start: "x", realtime_end: "x", date: "2026-10-16", value: "18.4" },
                { realtime_start: "x", realtime_end: "x", date: "2026-10-09", value: "16.0" },
              ],
            },
          }
        : undefined,
    );
    const r = await fetchFredSeries({ fetch: ex.fetch, apiKey: "k".repeat(32) }, "VIXCLS");
    expect(r?.change).toBeCloseTo(2.4, 10);
    expect(ex.requests[0]?.url.searchParams.get("series_id")).toBe("VIXCLS");
    expect(ex.requests[0]?.url.searchParams.get("file_type")).toBe("json");
  });
});

describe("Stablecoin supply", () => {
  it("adds every peg and compares with 7 and 30 days earlier", async () => {
    const day0 = Date.UTC(2026, 9, 16) / 1000;
    const row = (daysAgo: number, usd: number, eur = 0) => ({
      date: String(day0 - daysAgo * 86400),
      totalCirculatingUSD: { peggedUSD: usd, peggedEUR: eur },
    });
    const rows = [row(30, 280e9, 1e9), row(7, 290e9, 1e9), row(1, 292e9, 1e9), row(0, 293e9, 1e9)];
    const ex = fakeExchange((url) =>
      url.pathname === "/stablecoincharts/all" ? { body: rows } : undefined,
    );
    const r = await fetchStablecoinSupply({ fetch: ex.fetch }, NOW);
    expect(r?.totalUsd).toBe(294e9);
    expect(r?.change7dPct).toBeCloseTo((294 / 291 - 1) * 100, 10);
    expect(r?.change30dPct).toBeCloseTo((294 / 281 - 1) * 100, 10);
    expect(r?.date).toBe("2026-10-16");
  });
});
