import { describe, expect, it } from "vitest";
import { BinanceHistorySource } from "../binance/history.js";
import { BingxHistorySource } from "../bingx/history.js";
import { KucoinHistorySource, nanosToMs } from "../kucoin/history.js";
import { MexcHistorySource } from "../mexc/history.js";
import { canonicalSymbol } from "../symbols.js";
import { fakeExchange } from "../test-utils.js";
import { ExchangeHttpError } from "../types.js";

const creds = {
  apiKey: "key-0123456789abcdef",
  apiSecret: "secret-0123456789abcdef",
  passphrase: "pass",
};
const NOW = Date.UTC(2026, 8, 28);
const DAY = 86_400_000;
const window = { since: new Date(NOW - 7 * DAY), until: new Date(NOW) };

describe("canonicalSymbol", () => {
  it.each([
    ["BINANCE", "BTCUSDT", "BTCUSDT", "BTC", "USDT"],
    ["BINANCE", "1000PEPEUSDC", "1000PEPEUSDC", "1000PEPE", "USDC"],
    ["MEXC", "BTC_USDT", "BTCUSDT", "BTC", "USDT"],
    ["KUCOIN", "XBTUSDTM", "BTCUSDT", "BTC", "USDT"],
    ["KUCOIN", "DOGEUSDTM", "DOGEUSDT", "DOGE", "USDT"],
    ["BINGX", "BTC-USDT", "BTCUSDT", "BTC", "USDT"],
    ["BINANCE", "ETHFDUSD", "ETHFDUSD", "ETH", "FDUSD"],
  ] as const)("%s %s -> %s", (exchange, native, symbol, base, quote) => {
    expect(canonicalSymbol(exchange, native)).toEqual({
      symbol,
      base,
      quote,
      settle: quote,
      inverse: false,
    });
  });

  it("dated delivery contracts keep their expiry and settle in the quote", () => {
    expect(canonicalSymbol("BINANCE", "BTCUSDT_260327")).toEqual({
      symbol: "BTCUSDT_260327",
      base: "BTC",
      quote: "USDT",
      settle: "USDT",
      inverse: false,
    });
  });

  it.each([
    ["KUCOIN", "XBTUSDM", "BTCUSD", "BTC"],
    ["MEXC", "ETH_USD", "ETHUSD", "ETH"],
  ] as const)("inverse %s %s settles in the base coin", (exchange, native, symbol, base) => {
    expect(canonicalSymbol(exchange, native)).toEqual({
      symbol,
      base,
      quote: "USD",
      settle: base,
      inverse: true,
    });
  });
});

describe("BinanceHistorySource", () => {
  const trade = (id: number, time: number, extra: Record<string, unknown> = {}) => ({
    id,
    orderId: id * 10,
    symbol: "BTCUSDT",
    side: "BUY",
    positionSide: "BOTH",
    price: "60000",
    qty: "0.01",
    commission: "0.24",
    commissionAsset: "USDT",
    realizedPnl: "0",
    maker: false,
    time,
    ...extra,
  });

  it("discovers symbols from income and open positions, then pages fills", async () => {
    const t0 = NOW - DAY;
    const firstPage = Array.from({ length: 1000 }, (_, i) => trade(i + 1, t0 + i));
    const ex = fakeExchange((url) => {
      if (url.pathname === "/api/v3/time") return { body: { serverTime: NOW } };
      if (url.pathname === "/fapi/v1/income") {
        return {
          body: [
            {
              symbol: "BTCUSDT",
              incomeType: "COMMISSION",
              income: "-0.24",
              asset: "USDT",
              time: t0,
              tranId: 1,
              tradeId: "1",
            },
            {
              symbol: "",
              incomeType: "TRANSFER",
              income: "100",
              asset: "USDT",
              time: t0,
              tranId: 2,
            },
          ],
        };
      }
      if (url.pathname === "/fapi/v3/positionRisk") {
        return {
          body: [
            { symbol: "ETHUSDT", positionAmt: "0.5" },
            { symbol: "XRPUSDT", positionAmt: "0" },
          ],
        };
      }
      if (url.pathname === "/fapi/v1/klines") {
        expect(url.searchParams.get("symbol")).toBe("BNBUSDT");
        const minute = Math.floor(t0 / 60_000) * 60_000;
        return { body: [[minute, "600", "601", "599", "600.5", "10"]] };
      }
      if (url.pathname === "/fapi/v1/userTrades") {
        const symbol = url.searchParams.get("symbol");
        if (symbol === "ETHUSDT")
          return { body: [trade(5000, t0, { symbol: "ETHUSDT", commissionAsset: "BNB" })] };
        const start = Number(url.searchParams.get("startTime"));
        // Second page repeats the boundary trade (same millisecond) plus one new trade.
        return {
          body:
            start === window.since.getTime()
              ? firstPage
              : [trade(1000, t0 + 999), trade(1001, t0 + 1000)],
        };
      }
      return undefined;
    });
    const seen: string[] = [];
    const source = new BinanceHistorySource(creds, {
      fetch: ex.fetch,
      now: () => NOW,
      beforeRequest: async (u) => {
        seen.push(u.pathname);
      },
    });

    const batch = await source.fetchHistory(window);
    const btc = batch.fills.filter((f) => f.symbol === "BTCUSDT");
    expect(btc).toHaveLength(1001);
    expect(new Set(btc.map((f) => f.exchangeFillId)).size).toBe(1001);
    const eth = batch.fills.find((f) => f.symbol === "ETHUSDT");
    // BNB-paid fee converted at that minute's BNBUSDT price: 0.24 x 600.5.
    expect(eth).toMatchObject({ fee: "144.12", feeAsset: "USDT" });
    expect(eth?.raw).toMatchObject({ commissionAsset: "BNB", feeConversion: { pair: "BNBUSDT" } });
    expect(batch.income.map((i) => [i.type, i.symbol])).toEqual([
      ["COMMISSION", "BTCUSDT"],
      ["OTHER", null],
    ]);
    expect(seen.length).toBe(ex.requests.length); // every request went through the limiter
  });
});

describe("MexcHistorySource", () => {
  // Sample shape from MEXC (via CCXT): closeVol is in contracts.
  const position = (id: string, updateTime: number, extra: Record<string, unknown> = {}) => ({
    positionId: id,
    symbol: "RVN_USDT",
    positionType: "1",
    state: "3",
    holdVol: "0",
    closeVol: "1141",
    openAvgPrice: "0.03491",
    closeAvgPrice: "0.03494",
    realised: "0.1829",
    closeProfitLoss: "0.3423",
    fee: "0.1593977",
    leverage: "50",
    createTime: String(updateTime - 60_000),
    updateTime: String(updateTime),
    ...extra,
  });

  it("pages newest-first until it passes the window and converts contracts to coins", async () => {
    let pages = 0;
    const ex = fakeExchange((url) => {
      if (url.pathname === "/api/v1/contract/detail") {
        return {
          body: { success: true, code: 0, data: [{ symbol: "RVN_USDT", contractSize: 0.1 }] },
        };
      }
      if (url.pathname === "/api/v1/private/position/list/history_positions") {
        pages += 1;
        const page = Number(url.searchParams.get("page_num"));
        const rows =
          page === 1
            ? Array.from({ length: 100 }, (_, i) => position(`p${i}`, NOW - i * 60_000))
            : [position("old", NOW - 30 * DAY), position("inside", NOW - DAY)];
        return { body: { success: true, code: "0", data: rows } };
      }
      return undefined;
    });
    const source = new MexcHistorySource(creds, { fetch: ex.fetch, now: () => NOW });
    const batch = await source.fetchHistory(window);
    expect(pages).toBe(2);
    expect(batch.positions).toHaveLength(101);
    expect(batch.positions.map((p) => p.externalId)).not.toContain("old");

    const [record] = source.toRecords([batch.positions[0] as never]);
    expect(record).toMatchObject({
      symbol: "RVNUSDT",
      direction: "LONG",
      closed: true,
      quantity: "114.1",
      grossPnl: "0.3423",
      fees: "0.1593977",
      netPnl: "0.1829",
      entryPrice: "0.03491",
      exitPrice: "0.03494",
    });
  });
});

describe("KucoinHistorySource", () => {
  const classic = (closeId: string, type: string, extra: Record<string, unknown> = {}) => ({
    closeId,
    positionId: "pos-1",
    symbol: "XBTUSDTM",
    type,
    closeSize: 10,
    pnl: "4.9",
    realisedGrossCost: "-5",
    tradeFee: "0.1",
    fundingFee: "0",
    leverage: "5",
    openTime: NOW - 3 * DAY,
    closeTime: NOW - DAY,
    openPrice: "60000",
    closePrice: "60500",
    ...extra,
  });

  it("falls back to the classic account and merges partial closes into one position", async () => {
    const ex = fakeExchange((url) => {
      if (url.pathname === "/api/ua/v1/account/mode")
        return { status: 404, body: { code: "404000", msg: "Not Found" } };
      if (url.pathname === "/api/v1/contracts/active") {
        return { body: { code: "200000", data: [{ symbol: "XBTUSDTM", multiplier: 0.001 }] } };
      }
      if (url.pathname === "/api/v1/history-positions") {
        return {
          body: {
            code: "200",
            data: {
              totalPage: 1,
              items: [
                classic("c1", "CLOSE_PARTIAL_LONG", {
                  closePrice: "61000",
                  closeTime: NOW - 2 * DAY,
                }),
                classic("c2", "CLOSE_LONG"),
              ],
            },
          },
        };
      }
      return undefined;
    });
    const source = new KucoinHistorySource(creds, { fetch: ex.fetch, now: () => NOW });
    const batch = await source.fetchHistory(window);
    const [record, ...rest] = source.toRecords(batch.positions);
    expect(rest).toHaveLength(0);
    expect(record).toMatchObject({
      externalId: "C:pos-1",
      symbol: "BTCUSDT",
      direction: "LONG",
      closed: true,
      quantity: "0.02", // 20 lots x 0.001
      exitPrice: "60750",
      grossPnl: "10",
      fees: "0.2",
      netPnl: "9.8",
      funding: "0",
    });
  });

  it("uses the unified endpoint, converts nanoseconds and splits full pages by time", async () => {
    const calls: string[] = [];
    const item = (id: string) => ({
      closeId: id,
      symbol: "DOGEUSDTM",
      side: "LONG",
      entryPrice: "0.09641",
      avgClosePrice: "0.09613",
      maxSize: "1",
      leverage: "3",
      realizedPnL: "-0.0395524",
      fee: "0.0115524",
      fundingFee: "0",
      closingTime: 1774469647311000000,
      creationTime: 1774468501294000000,
    });
    const ex = fakeExchange((url) => {
      if (url.pathname === "/api/ua/v1/account/mode") {
        return { body: { code: "200000", data: { selfAccountMode: "UNIFIED" } } };
      }
      if (url.pathname === "/api/v1/contracts/active") {
        return { body: { code: "200000", data: [{ symbol: "DOGEUSDTM", multiplier: 100 }] } };
      }
      if (url.pathname === "/api/ua/v1/position/history") {
        calls.push(url.search);
        const first = calls.length === 1;
        const rows = first
          ? Array.from({ length: 100 }, (_, i) => item(`x${i}`))
          : [item(`y${calls.length}`)];
        return { body: { code: "200000", data: { items: rows } } };
      }
      return undefined;
    });
    const source = new KucoinHistorySource(creds, { fetch: ex.fetch, now: () => NOW });
    const batch = await source.fetchHistory(window);
    expect(calls).toHaveLength(3); // full page -> two halves
    expect(batch.positions).toHaveLength(2);
    const [record] = source.toRecords([batch.positions[0] as never]);
    expect(record).toMatchObject({
      symbol: "DOGEUSDT",
      quantity: "100",
      netPnl: "-0.0395524",
      fees: "0.0115524",
    });
    expect(record?.closedAt?.getTime()).toBe(1774469647311);
  });

  it("converts nanosecond timestamps without precision loss", () => {
    expect(nanosToMs("1774469647311999999")).toBe(1774469647311);
    expect(nanosToMs(1774469647311)).toBe(1774469647311);
  });

  it("surfaces non-4xx failures from mode detection", async () => {
    const ex = fakeExchange(() => ({ status: 503, body: { code: "503000", msg: "busy" } }));
    const source = new KucoinHistorySource(creds, { fetch: ex.fetch });
    await expect(source.fetchHistory(window)).rejects.toBeInstanceOf(ExchangeHttpError);
  });
});

describe("BingxHistorySource", () => {
  // Sample shape from BingX (via CCXT).
  const pos = {
    positionId: "1861675561156571136",
    symbol: "LTC-USDT",
    positionSide: "LONG",
    openTime: NOW - 2 * DAY,
    updateTime: NOW - DAY,
    avgPrice: "95.18",
    avgClosePrice: "129.48",
    realisedProfit: "102.89",
    netProfit: "99.63",
    positionAmt: "30.0",
    closePositionAmt: "30.0",
    leverage: 6,
    closeAllPositions: true,
    positionCommission: "-0.33699650000000003",
    totalFunding: "-2.921461693902908",
  };

  it("discovers symbols from income and reads position history", async () => {
    const positionCalls: URLSearchParams[] = [];
    const ex = fakeExchange((url) => {
      if (url.pathname === "/openApi/swap/v2/user/income") {
        return {
          body: {
            code: 0,
            data: [
              {
                symbol: "LTC-USDT",
                incomeType: "TRADING_FEE",
                income: "-0.33",
                asset: "USDT",
                time: NOW - DAY,
                tranId: "t1",
              },
              {
                symbol: "ETH-USDC",
                incomeType: "FUNDING_FEE",
                income: "-0.1",
                asset: "USDC",
                time: NOW - DAY,
                tranId: "t2",
              },
            ],
          },
        };
      }
      if (url.pathname === "/openApi/swap/v1/trade/positionHistory") {
        positionCalls.push(url.searchParams);
        const rows = url.searchParams.get("symbol") === "LTC-USDT" ? [pos] : [];
        return { body: { code: 0, data: { positionHistory: rows } } };
      }
      return undefined;
    });
    const source = new BingxHistorySource(creds, { fetch: ex.fetch, now: () => NOW });
    const batch = await source.fetchHistory(window);

    expect(positionCalls.map((p) => [p.get("symbol"), p.get("currency")])).toEqual([
      ["ETH-USDC", "USDC"],
      ["LTC-USDT", null],
    ]);
    // Looks back beyond the window for positions opened earlier.
    expect(Number(positionCalls[0]?.get("startTs"))).toBe(window.since.getTime() - 30 * DAY);
    expect(batch.income.map((i) => i.type)).toEqual(["COMMISSION", "FUNDING"]);

    const [record] = source.toRecords(batch.positions);
    expect(record).toMatchObject({
      symbol: "LTCUSDT",
      direction: "LONG",
      closed: true,
      quantity: "30",
      entryPrice: "95.18",
      exitPrice: "129.48",
      grossPnl: "102.89",
      fees: "0.33699650000000003",
      funding: "-2.921461693902908",
      netPnl: "99.63",
      leverage: "6",
    });
  });
});

describe("bingxDirection (one-way mode reports BOTH)", async () => {
  const { bingxDirection } = await import("../bingx/history.js");
  const base = { positionId: "1", symbol: "BTC-USDT", openTime: 0, updateTime: 0 };
  it.each([
    [{ positionSide: "SHORT" }, "SHORT"],
    [{ positionSide: "LONG" }, "LONG"],
    [{ positionSide: "BOTH", positionAmt: "-0.5" }, "SHORT"],
    [{ positionSide: "BOTH", avgPrice: "100", avgClosePrice: "90", realisedProfit: "10" }, "SHORT"],
    [{ positionSide: "BOTH", avgPrice: "100", avgClosePrice: "90", realisedProfit: "-10" }, "LONG"],
    [{ positionSide: "BOTH", avgPrice: "100", avgClosePrice: "110", realisedProfit: "10" }, "LONG"],
  ] as const)("%j -> %s", (extra, expected) => {
    expect(bingxDirection({ ...base, ...extra })).toBe(expected);
  });
});
