import { dec } from "@atc/trade-engine";
import { describe, expect, it } from "vitest";
import { BinanceHistorySource } from "../binance/history.js";
import { BingxHistorySource } from "../bingx/history.js";
import { KucoinHistorySource } from "../kucoin/history.js";
import { MexcHistorySource } from "../mexc/history.js";
import { fakeExchange } from "../test-utils.js";
import { unrealizedFromPrices } from "./snapshot.js";

const creds = {
  apiKey: "key-0123456789abcdef",
  apiSecret: "secret-0123456789abcdef",
  passphrase: "pass",
};

describe("unrealizedFromPrices", () => {
  it("linear long and short", () => {
    const base = { size: dec("0.5"), entry: dec("60000"), mark: dec("61000"), inverse: false };
    expect(unrealizedFromPrices({ ...base, direction: "LONG" })).toBe("500");
    expect(unrealizedFromPrices({ ...base, direction: "SHORT" })).toBe("-500");
  });

  it("inverse pays in coins: 1000 USD long from 50k to 62.5k earns 0.004 BTC", () => {
    expect(
      unrealizedFromPrices({
        direction: "LONG",
        size: dec("1000"),
        entry: dec("50000"),
        mark: dec("62500"),
        inverse: true,
      }),
    ).toBe("0.004");
  });

  it("no price, no figure", () => {
    expect(
      unrealizedFromPrices({
        direction: "LONG",
        size: dec(1),
        entry: dec(0),
        mark: dec(1),
        inverse: false,
      }),
    ).toBeNull();
  });
});

describe("open positions", () => {
  it("Binance: skips empty hedge sides, derives leverage and margin mode", async () => {
    const ex = fakeExchange((url) =>
      url.pathname === "/api/v3/time"
        ? { body: { serverTime: Date.now() } }
        : url.pathname === "/fapi/v3/positionRisk"
          ? {
              body: [
                {
                  symbol: "BTCUSDT",
                  positionSide: "BOTH",
                  positionAmt: "-0.010",
                  entryPrice: "62000",
                  markPrice: "61000",
                  unRealizedProfit: "10.00",
                  liquidationPrice: "0",
                  notional: "-610",
                  initialMargin: "61",
                  isolatedWallet: "0",
                },
                { symbol: "ETHUSDT", positionSide: "LONG", positionAmt: "0.000" },
              ],
            }
          : undefined,
    );
    const source = new BinanceHistorySource(creds, { fetch: ex.fetch });
    expect(await source.fetchOpenPositions()).toEqual([
      {
        externalId: "BTCUSDT:BOTH",
        symbol: "BTCUSDT",
        direction: "SHORT",
        quantity: "0.01",
        entryPrice: "62000",
        markPrice: "61000",
        unrealizedPnl: "10",
        leverage: "10",
        liquidationPrice: null,
        marginMode: "CROSS",
        openedAt: null,
      },
    ]);
  });

  it("MEXC: converts contracts and computes unrealised PnL from the fair price", async () => {
    const ex = fakeExchange((url) => {
      if (url.pathname === "/api/v1/private/position/open_positions") {
        return {
          body: {
            success: true,
            code: 0,
            data: [
              {
                positionId: 1394650,
                symbol: "ETH_USDT",
                positionType: 2,
                openType: 1,
                state: 1,
                holdVol: 30,
                holdAvgPrice: 3000,
                openAvgPrice: 3000,
                liquidatePrice: 3300,
                leverage: 20,
                createTime: 1_760_000_000_000,
                updateTime: 1_760_000_100_000,
              },
            ],
          },
        };
      }
      if (url.pathname === "/api/v1/contract/detail") {
        return {
          body: { success: true, code: 0, data: [{ symbol: "ETH_USDT", contractSize: 0.01 }] },
        };
      }
      if (url.pathname === "/api/v1/contract/ticker") {
        return {
          body: { success: true, code: 0, data: [{ symbol: "ETH_USDT", fairPrice: 2900 }] },
        };
      }
      return undefined;
    });
    const source = new MexcHistorySource(creds, { fetch: ex.fetch });
    const [p] = await source.fetchOpenPositions();
    expect(p).toMatchObject({
      externalId: "1394650",
      symbol: "ETHUSDT",
      direction: "SHORT",
      quantity: "0.3", // 30 contracts x 0.01 ETH
      markPrice: "2900",
      unrealizedPnl: "30", // short 0.3 ETH, price fell 100
      leverage: "20",
      marginMode: "ISOLATED",
      openedAt: new Date(1_760_000_000_000),
    });
  });

  it("MEXC: no open positions means no market-data calls", async () => {
    const ex = fakeExchange((url) =>
      url.pathname === "/api/v1/private/position/open_positions"
        ? { body: { success: true, code: 0, data: [] } }
        : undefined,
    );
    const source = new MexcHistorySource(creds, { fetch: ex.fetch });
    expect(await source.fetchOpenPositions()).toEqual([]);
    expect(ex.requests).toHaveLength(1);
  });

  const kucoin = (mode: "CLASSIC" | "UNIFIED", positions: unknown) =>
    fakeExchange((url) => {
      if (url.pathname === "/api/ua/v1/account/mode") {
        return { body: { code: "200000", data: { selfAccountMode: mode } } };
      }
      if (url.pathname === "/api/v1/contracts/active") {
        return {
          body: {
            code: "200000",
            data: [
              { symbol: "XBTUSDTM", multiplier: 0.001 },
              { symbol: "XBTUSDM", multiplier: -1 },
            ],
          },
        };
      }
      if (
        url.pathname === "/api/v1/positions" ||
        url.pathname === "/api/ua/v1/unified/position/open-list"
      ) {
        return { body: { code: "200000", data: positions } };
      }
      return undefined;
    });

  it("KuCoin classic: signed lots become direction and coin size; inverse size stays USD", async () => {
    const ex = kucoin("CLASSIC", [
      {
        id: "615ba79f",
        symbol: "XBTUSDTM",
        isOpen: true,
        currentQty: -20,
        avgEntryPrice: 60000,
        markPrice: 59000,
        unrealisedPnl: 20,
        realLeverage: 5,
        liquidationPrice: 70000,
        crossMode: false,
        openingTimestamp: 1_760_000_000_000,
      },
      { symbol: "XBTUSDM", isOpen: true, currentQty: 1000, avgEntryPrice: 60000, crossMode: true },
      { symbol: "ETHUSDTM", isOpen: false, currentQty: 0 },
    ]);
    const source = new KucoinHistorySource(creds, { fetch: ex.fetch });
    const [linear, inverse, ...rest] = await source.fetchOpenPositions();
    expect(rest).toHaveLength(0);
    expect(linear).toMatchObject({
      symbol: "BTCUSDT",
      direction: "SHORT",
      quantity: "0.02",
      unrealizedPnl: "20",
      leverage: "5",
      marginMode: "ISOLATED",
    });
    expect(inverse).toMatchObject({
      symbol: "BTCUSD",
      direction: "LONG",
      quantity: "1000",
      marginMode: "CROSS",
    });
  });

  it("KuCoin unified: nanosecond times and explicit side", async () => {
    const ex = kucoin("UNIFIED", [
      {
        id: "3000",
        symbol: "XBTUSDTM",
        side: "SHORT",
        size: "4",
        entryPrice: "60000",
        markPrice: "60500",
        unrealizedPnL: "-2",
        leverage: "3",
        marginMode: "CROSS",
        creationTime: "1760000000000000000",
      },
    ]);
    const source = new KucoinHistorySource(creds, { fetch: ex.fetch });
    const [p] = await source.fetchOpenPositions();
    expect(p).toMatchObject({
      symbol: "BTCUSDT",
      direction: "SHORT",
      quantity: "0.004",
      unrealizedPnl: "-2",
      openedAt: new Date(1_760_000_000_000),
    });
  });

  it("BingX: derives the mark price when it is missing", async () => {
    const ex = fakeExchange((url) =>
      url.pathname === "/openApi/swap/v2/user/positions"
        ? {
            body: {
              code: 0,
              msg: "",
              data: [
                {
                  positionId: "1735",
                  symbol: "BNB-USDT",
                  positionSide: "SHORT",
                  isolated: true,
                  positionAmt: "0.20",
                  avgPrice: "246.43",
                  unrealizedProfit: "-0.0653",
                  leverage: 5,
                  liquidationPrice: 294.17,
                },
              ],
            },
          }
        : undefined,
    );
    const source = new BingxHistorySource(creds, { fetch: ex.fetch });
    const [p] = await source.fetchOpenPositions();
    expect(p).toMatchObject({
      externalId: "1735",
      symbol: "BNBUSDT",
      direction: "SHORT",
      quantity: "0.2",
      markPrice: "246.7565", // 246.43 + 0.0653 / 0.2
      unrealizedPnl: "-0.0653",
      liquidationPrice: "294.17",
      marginMode: "ISOLATED",
    });
  });
});

describe("MEXC without a contract size", () => {
  it("keeps the position but reports no size or PnL rather than a wrong one", async () => {
    const ex = fakeExchange((url) => {
      if (url.pathname === "/api/v1/private/position/open_positions")
        return {
          body: {
            success: true,
            code: 0,
            data: [
              {
                positionId: 1,
                symbol: "NEW_USDT",
                positionType: 1,
                holdVol: 100,
                holdAvgPrice: 2,
                createTime: 1,
              },
            ],
          },
        };
      if (url.pathname === "/api/v1/contract/detail")
        return { body: { success: true, code: 0, data: [] } };
      if (url.pathname === "/api/v1/contract/ticker")
        return { body: { success: true, code: 0, data: [{ symbol: "NEW_USDT", fairPrice: 3 }] } };
      return undefined;
    });
    const [p] = await new MexcHistorySource(creds, { fetch: ex.fetch }).fetchOpenPositions();
    expect(p).toMatchObject({
      symbol: "NEWUSDT",
      quantity: null,
      unrealizedPnl: null,
      markPrice: "3",
    });
  });
});
