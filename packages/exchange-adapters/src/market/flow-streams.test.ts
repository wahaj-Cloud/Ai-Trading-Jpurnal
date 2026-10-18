import { describe, expect, it } from "vitest";
import {
  okxSymbol,
  parseBinance,
  parseBybit,
  parseOkx,
  TakerOrderGrouper,
} from "./flow-streams.js";

describe("stream parsers", () => {
  it("Binance aggTrade: m=true means the taker sold", () => {
    const r = parseBinance({
      stream: "btcusdt@aggTrade",
      data: { e: "aggTrade", s: "BTCUSDT", p: "60000.5", q: "2.5", T: 1700000000000, m: true },
    });
    expect(r.trades).toEqual([
      {
        exchange: "BINANCE",
        symbol: "BTCUSDT",
        ts: 1700000000000,
        side: "sell",
        price: 60000.5,
        qty: 2.5,
      },
    ]);
  });

  it("Binance forceOrder: a SELL liquidation order closes a long; filled size at average price", () => {
    const r = parseBinance({
      stream: "!forceOrder@arr",
      data: {
        e: "forceOrder",
        o: { s: "ETHUSDT", S: "SELL", q: "10", p: "2990", ap: "3000", z: "10", T: 1700000000001 },
      },
    });
    expect(r.liquidations[0]).toMatchObject({ side: "long", price: 3000, qty: 10, usd: 30000 });
  });

  it("ignores markets we do not track and malformed rows", () => {
    expect(
      parseBinance({ data: { e: "aggTrade", s: "PEPEUSDT", p: "1", q: "1", T: 1, m: false } })
        .trades,
    ).toEqual([]);
    expect(
      parseBinance({ data: { e: "aggTrade", s: "BTCUSDT", p: "x", q: "1", T: 1 } }).trades,
    ).toEqual([]);
  });

  it("Bybit: publicTrade S is the taker; allLiquidation S=Buy is a long liquidated", () => {
    const t = parseBybit({
      topic: "publicTrade.SOLUSDT",
      data: [{ T: 5, s: "SOLUSDT", S: "Sell", v: "100", p: "150", i: "x", BT: false }],
    });
    expect(t.trades[0]).toMatchObject({ exchange: "BYBIT", side: "sell", qty: 100, price: 150 });
    const l = parseBybit({
      topic: "allLiquidation.SOLUSDT",
      data: [{ T: 6, s: "SOLUSDT", S: "Buy", v: "20", p: "140" }],
    });
    expect(l.liquidations[0]).toMatchObject({ side: "long", usd: 2800 });
  });

  it("OKX: contracts converted with the contract value; posSide names the liquidated side", () => {
    const ctVal = new Map([["BTC-USDT-SWAP", 0.01]]);
    expect(okxSymbol("BTC-USDT-SWAP")).toBe("BTCUSDT");
    const t = parseOkx(
      {
        arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
        data: [{ instId: "BTC-USDT-SWAP", px: "60000", sz: "500", side: "buy", ts: "7" }],
      },
      ctVal,
    );
    expect(t.trades[0]).toMatchObject({ side: "buy", qty: 5, price: 60000 });
    const l = parseOkx(
      {
        arg: { channel: "liquidation-orders", instType: "SWAP" },
        data: [
          {
            instId: "BTC-USDT-SWAP",
            details: [{ side: "buy", posSide: "short", bkPx: "61000", sz: "100", ts: "8" }],
          },
        ],
      },
      ctVal,
    );
    expect(l.liquidations[0]).toMatchObject({ side: "short", qty: 1, usd: 61000 });
    // Unknown contract value: skipped, never guessed.
    expect(
      parseOkx(
        {
          arg: { channel: "trades" },
          data: [{ instId: "ETH-USDT-SWAP", px: "1", sz: "1", side: "buy", ts: "1" }],
        },
        ctVal,
      ).trades,
    ).toEqual([]);
  });
});

describe("taker order grouping", () => {
  const tick = (over: object) => ({
    exchange: "BINANCE" as const,
    symbol: "BTCUSDT" as const,
    ts: 1000,
    side: "buy" as const,
    price: 60_000,
    qty: 1,
    ...over,
  });

  it("adds fills of one market order into one whale trade at the average price", () => {
    const g = new TakerOrderGrouper();
    expect(g.push(tick({ price: 60_000, qty: 3 }), 0)).toEqual([]);
    expect(g.push(tick({ price: 60_010, qty: 3 }), 1)).toEqual([]);
    const done = g.push(tick({ ts: 1001, qty: 0.1 }), 2); // a new order completes the first
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ qty: 6, fills: 2, usd: 360_030 });
    expect(done[0]?.price).toBeCloseTo(60_005, 6);
  });

  it("orders below the whale size are dropped; idle orders flush", () => {
    const g = new TakerOrderGrouper();
    g.push(tick({ qty: 1 }), 0); // $60k < $250k
    expect(g.flush(1000)).toEqual([]);
    g.push(tick({ ts: 2000, qty: 5 }), 0);
    expect(g.flush(100)).toEqual([]);
    expect(g.flush(400)).toHaveLength(1);
  });

  it("different markets and sides never merge", () => {
    const g = new TakerOrderGrouper(() => 1);
    g.push(tick({}), 0);
    g.push(tick({ symbol: "ETHUSDT" }), 0);
    expect(g.push(tick({ side: "sell" }), 0)).toHaveLength(1);
    expect(g.flush(0, true)).toHaveLength(2);
  });
});
