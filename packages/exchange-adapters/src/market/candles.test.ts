import { describe, expect, it } from "vitest";
import { fakeExchange } from "../test-utils.js";
import { fetchCandles, nativeSymbol } from "./candles.js";

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);

describe("nativeSymbol", () => {
  it("maps canonical pairs back to each exchange", () => {
    expect(nativeSymbol("BINANCE", "BTCUSDT", "BTC", "USDT")).toBe("BTCUSDT");
    expect(nativeSymbol("MEXC", "BTCUSDT", "BTC", "USDT")).toBe("BTC_USDT");
    expect(nativeSymbol("KUCOIN", "BTCUSDT", "BTC", "USDT")).toBe("XBTUSDTM");
    expect(nativeSymbol("KUCOIN", "ETHUSDT", "ETH", "USDT")).toBe("ETHUSDTM");
    expect(nativeSymbol("BINGX", "SOLUSDT", "SOL", "USDT")).toBe("SOL-USDT");
  });
});

describe("fetchCandles", () => {
  it("Binance: pages forward, keeps the range, drops duplicates", async () => {
    const ex = fakeExchange((url) => {
      if (url.pathname !== "/fapi/v1/klines") return undefined;
      const start = Number(url.searchParams.get("startTime"));
      const end = Number(url.searchParams.get("endTime"));
      const rows = [];
      for (let t = start; t <= end && rows.length < 1500; t += H)
        rows.push([t, "1", "2", "0.5", "1.5", "10"]);
      return { body: rows };
    });
    const out = await fetchCandles(
      "BINANCE",
      { binance: { fetch: ex.fetch } },
      "BTCUSDT",
      "1h",
      T0,
      T0 + 1600 * H,
    );
    expect(out).toHaveLength(1601);
    expect(out[0]).toEqual({ t: T0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 });
    expect(ex.requests.length).toBe(2);
    expect(ex.requests[0]?.url.searchParams.get("interval")).toBe("1h");
  });

  it("MEXC: column arrays in seconds", async () => {
    const ex = fakeExchange((url) =>
      url.pathname === "/api/v1/contract/kline/BTC_USDT"
        ? {
            body: {
              success: true,
              code: 0,
              data: { time: [T0 / 1000], open: [1], high: [3], low: [0.5], close: [2], vol: [7] },
            },
          }
        : undefined,
    );
    const out = await fetchCandles(
      "MEXC",
      { mexc: { fetch: ex.fetch } },
      "BTC_USDT",
      "4h",
      T0,
      T0 + 4 * H,
    );
    expect(out).toEqual([{ t: T0, o: 1, h: 3, l: 0.5, c: 2, v: 7 }]);
    expect(ex.requests[0]?.url.searchParams.get("interval")).toBe("Hour4");
  });

  it("KuCoin and BingX shapes", async () => {
    const ku = fakeExchange((url) =>
      url.pathname === "/api/v1/kline/query"
        ? { body: { code: "200000", data: [[T0, 1, 2, 0.5, 1.5, 9]] } }
        : undefined,
    );
    expect(
      await fetchCandles("KUCOIN", { kucoin: { fetch: ku.fetch } }, "XBTUSDTM", "15m", T0, T0 + H),
    ).toEqual([{ t: T0, o: 1, h: 2, l: 0.5, c: 1.5, v: 9 }]);
    expect(ku.requests[0]?.url.searchParams.get("granularity")).toBe("15");
    const bx = fakeExchange((url) =>
      url.pathname === "/openApi/swap/v3/quote/klines"
        ? {
            body: {
              code: 0,
              data: [{ open: "1", high: "2", low: "0.5", close: "1.5", volume: "3", time: T0 }],
            },
          }
        : undefined,
    );
    expect(
      await fetchCandles("BINGX", { bingx: { fetch: bx.fetch } }, "BTC-USDT", "5m", T0, T0 + H),
    ).toHaveLength(1);
  });

  it("an unknown symbol is an error, not an empty chart", async () => {
    const ex = fakeExchange(() => ({ status: 400, body: { code: -1121, msg: "Invalid symbol." } }));
    await expect(
      fetchCandles("BINANCE", { binance: { fetch: ex.fetch } }, "NOPE", "1h", T0, T0 + H),
    ).rejects.toThrow();
  });
});
