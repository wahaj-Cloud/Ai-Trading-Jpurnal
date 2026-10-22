import type { PrismaClient } from "@atc/db";
import { afterEach, describe, expect, it } from "vitest";
import { fakeSnapshotSql } from "../testing/fake-snapshots.js";
import { FlowCollector } from "./flow-collector.js";

/** Minimal stand-in for the platform WebSocket. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  private handlers = new Map<string, ((ev: { data?: unknown }) => void)[]>();
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: (ev: { data?: unknown }) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  send(m: string) {
    this.sent.push(m);
  }
  close() {
    this.readyState = 3;
    for (const fn of this.handlers.get("close") ?? []) fn({});
  }
  emit(type: string, data?: unknown) {
    if (type === "open") this.readyState = 1;
    for (const fn of this.handlers.get(type) ?? []) fn({ data });
  }
}

function fakes() {
  const rows = { whales: [] as unknown[], liqs: [] as unknown[], status: [] as unknown[] };
  const statusStore = new Map<string, unknown>();
  const db = {
    whaleTrade: {
      createMany: async (a: { data: unknown[] }) => rows.whales.push(...a.data),
      deleteMany: async () => ({}),
    },
    liquidationEvent: {
      createMany: async (a: { data: unknown[] }) => rows.liqs.push(...a.data),
      deleteMany: async () => ({}),
    },
    ...fakeSnapshotSql(statusStore),
  } as unknown as PrismaClient;
  let holder: string | null = null;
  const redis = {
    set: async (_k: string, v: string) => {
      if (holder) return null;
      holder = v;
      return "OK";
    },
    eval: async (_s: string, _n: number, _k: string, token: string) => (holder === token ? 1 : 0),
  };
  const fetchFn = (async () =>
    Response.json({
      data: [
        { instId: "BTC-USDT-SWAP", ctVal: "0.01", ctType: "linear" },
        { instId: "ETH-USDT-SWAP", ctVal: "0.1", ctType: "linear" },
      ],
    })) as typeof fetch;
  return { rows, db, redis, fetchFn, statusStore };
}

afterEach(() => {
  FakeSocket.all = [];
});

describe("flow collector", () => {
  it("only one worker collects; feeds subscribe; whales and liquidations are stored", async () => {
    const f = fakes();
    let now = 1_000;
    const deps = {
      db: f.db,
      redis: f.redis,
      fetchFn: f.fetchFn,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      now: () => now,
    };
    const a = new FlowCollector(deps);
    const b = new FlowCollector(deps);
    await a.tickLeadership();
    await b.tickLeadership();
    expect(a.isLeader).toBe(true);
    expect(b.isLeader).toBe(false);
    expect(FakeSocket.all).toHaveLength(3);

    const [binance, bybit, okx] = FakeSocket.all as [FakeSocket, FakeSocket, FakeSocket];
    expect(binance.url).toContain("/market/stream?streams=btcusdt@aggTrade/");
    expect(binance.url).toContain("!forceOrder@arr");
    for (const s of FakeSocket.all) s.emit("open");
    expect(bybit.sent).toContain(
      JSON.stringify({ op: "subscribe", args: ["allLiquidation.BTCUSDT"] }),
    );
    expect(okx.sent).toContain(
      JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: "BTC-USDT-SWAP" }] }),
    );

    // Three fills of one $300k market buy on Binance, then an unrelated small trade.
    const fill = (q: string, T: number, m = false) =>
      JSON.stringify({
        stream: "btcusdt@aggTrade",
        data: { e: "aggTrade", s: "BTCUSDT", p: "60000", q, T, m },
      });
    binance.emit("message", fill("2", 5));
    binance.emit("message", fill("2", 5));
    binance.emit("message", fill("1", 5));
    binance.emit("message", fill("0.1", 6, true));
    // A Bybit long liquidation and an OKX whale sell of 500 contracts × 0.01 = 5 BTC.
    bybit.emit(
      "message",
      JSON.stringify({
        topic: "allLiquidation.BTCUSDT",
        data: [{ T: 7, s: "BTCUSDT", S: "Buy", v: "0.5", p: "59000" }],
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await a.tickLeadership(); // OKX contract sizes were loaded on take-over
    okx.emit(
      "message",
      JSON.stringify({
        arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
        data: [{ instId: "BTC-USDT-SWAP", px: "60000", sz: "500", side: "sell", ts: "8" }],
      }),
    );
    okx.emit("message", "pong");
    await new Promise((r) => setTimeout(r, 0));
    now += 1_000;
    a.collectIdle();
    const written = await a.flush();
    expect(written).toEqual({ whales: 2, liquidations: 1 });
    expect(f.rows.whales).toEqual([
      expect.objectContaining({ exchange: "BINANCE", side: "buy", usd: "300000.00", fills: 3 }),
      expect.objectContaining({
        exchange: "OKX",
        side: "sell",
        qty: "5.0000000000",
        usd: "300000.00",
      }),
    ]);
    expect(f.rows.liqs).toEqual([
      expect.objectContaining({ exchange: "BYBIT", side: "long", usd: "29500.00" }),
    ]);
    await a.saveStatus();
    expect(JSON.stringify([...f.statusStore.values()])).toContain('"connected":true');
    await a.stop();
  });

  it("reconnects a dropped feed", async () => {
    const f = fakes();
    const c = new FlowCollector({
      db: f.db,
      redis: f.redis,
      fetchFn: f.fetchFn,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });
    await c.tickLeadership();
    const first = FakeSocket.all[0] as FakeSocket;
    first.emit("open");
    first.close();
    await new Promise((r) => setTimeout(r, 1_100));
    expect(FakeSocket.all.filter((s) => s.url === first.url).length).toBe(2);
    await c.stop();
  });
});
