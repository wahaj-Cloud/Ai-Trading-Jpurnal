import { describe, expect, it } from "vitest";
import { fakeExchange } from "../test-utils.js";
import {
  fetchBinanceDeltaCandles,
  fetchBinanceDepth,
  fetchBinanceFundingAll,
  fetchBinanceOpenInterestNow,
} from "./binance-public.js";

const row = (t: number, o: string, c: string, quote: string, buy: string) => [
  t,
  o,
  String(Math.max(Number(o), Number(c)) + 1),
  String(Math.min(Number(o), Number(c)) - 0.5),
  c,
  "1",
  t + 299_999,
  quote,
  10,
  "0.5",
  buy,
  "0",
];

describe("Binance delta candles", () => {
  it("reads quote and taker-buy quote volume and drops the forming candle", async () => {
    const ex = fakeExchange((url) => {
      expect(url.pathname).toBe("/fapi/v1/klines");
      expect(url.searchParams.get("interval")).toBe("5m");
      expect(url.searchParams.get("limit")).toBe("3");
      return {
        body: [
          row(0, "100", "101", "1000", "600"),
          row(300_000, "101", "102", "2000", "500"),
          row(600_000, "102", "103", "50", "10"), // still forming at now
        ],
      };
    });
    const rows = await fetchBinanceDeltaCandles({ fetch: ex.fetch }, "BTCUSDT", 2, 700_000);
    expect(rows).toEqual([
      { t: 0, o: 100, h: 102, l: 99.5, c: 101, base: 1, quote: 1000, takerBuyQuote: 600 },
      { t: 300_000, o: 101, h: 103, l: 100.5, c: 102, base: 1, quote: 2000, takerBuyQuote: 500 },
    ]);
  });

  it("rejects rows where takers bought more than was traded", async () => {
    const ex = fakeExchange(() => ({ body: [row(0, "1", "1", "10", "11")] }));
    expect(await fetchBinanceDeltaCandles({ fetch: ex.fetch }, "X", 5, 1e12)).toEqual([]);
  });
});

describe("Binance funding for every contract", () => {
  it("maps symbols to the next funding rate and skips blanks", async () => {
    const ex = fakeExchange(() => ({
      body: [
        { symbol: "BTCUSDT", lastFundingRate: "0.00010000" },
        { symbol: "BTCUSDT_261225", lastFundingRate: "" },
        { symbol: "ETHUSDT", lastFundingRate: "-0.00002500" },
      ],
    }));
    const m = await fetchBinanceFundingAll({ fetch: ex.fetch });
    expect([...m]).toEqual([
      ["BTCUSDT", 0.0001],
      ["ETHUSDT", -0.000025],
    ]);
  });
});

describe("Binance live open interest and order book", () => {
  it("reads open interest now", async () => {
    const ex = fakeExchange((url) => {
      expect(url.pathname).toBe("/fapi/v1/openInterest");
      return { body: { symbol: "BTCUSDT", openInterest: "81234.5", time: 1700000000000 } };
    });
    expect(await fetchBinanceOpenInterestNow({ fetch: ex.fetch }, "BTCUSDT")).toEqual({
      t: 1700000000000,
      oi: 81234.5,
    });
  });

  it("reads the book best-first and drops empty levels", async () => {
    const ex = fakeExchange((url) => {
      expect(url.searchParams.get("limit")).toBe("1000");
      return {
        body: {
          T: 5,
          bids: [
            ["99", "2"],
            ["100", "1"],
            ["98", "0"],
          ],
          asks: [
            ["102", "1"],
            ["101", "3"],
          ],
        },
      };
    });
    expect(await fetchBinanceDepth({ fetch: ex.fetch }, "X")).toEqual({
      t: 5,
      bids: [
        [100, 1],
        [99, 2],
      ],
      asks: [
        [101, 3],
        [102, 1],
      ],
    });
  });
});

describe("Binance futures universe", () => {
  it("includes gold and silver TradFi perpetuals and marks them", async () => {
    const { fetchBinanceUniverse } = await import("./binance-public.js");
    const ex = fakeExchange((url) => {
      if (url.pathname === "/fapi/v1/exchangeInfo")
        return {
          body: {
            symbols: [
              {
                symbol: "BTCUSDT",
                baseAsset: "BTC",
                quoteAsset: "USDT",
                contractType: "PERPETUAL",
                status: "TRADING",
                onboardDate: 1,
              },
              {
                symbol: "XAUUSDT",
                baseAsset: "XAU",
                quoteAsset: "USDT",
                contractType: "TRADIFI_PERPETUAL",
                status: "TRADING",
                onboardDate: 2,
              },
              {
                symbol: "BTCUSDT_261225",
                baseAsset: "BTC",
                quoteAsset: "USDT",
                contractType: "CURRENT_QUARTER",
                status: "TRADING",
                onboardDate: 3,
              },
              {
                symbol: "OLDUSDT",
                baseAsset: "OLD",
                quoteAsset: "USDT",
                contractType: "PERPETUAL",
                status: "SETTLING",
                onboardDate: 4,
              },
            ],
          },
        };
      return {
        body: [
          { symbol: "BTCUSDT", quoteVolume: "10" },
          { symbol: "XAUUSDT", quoteVolume: "5" },
        ],
      };
    });
    const u = await fetchBinanceUniverse({ fetch: ex.fetch });
    expect(u.map((x) => [x.symbol, x.tradfi])).toEqual([
      ["BTCUSDT", false],
      ["XAUUSDT", true],
    ]);
  });
});
