import type { PrismaClient } from "@atc/db";
import type { MarketDeskDto } from "@atc/shared";
import { describe, expect, it } from "vitest";
import { fakeSnapshotSql } from "../testing/fake-snapshots.js";
import { runMarketDesk } from "./desk.js";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 14, 12, 2, 0);
const LAST = Math.floor(NOW / H) * H;

/** Binance klines and funding plus Bybit/OKX open interest, in each exchange's own format. */
function fakeFetch(opts: { goldDown?: boolean } = {}) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    const symbol = url.searchParams.get("symbol") ?? "";
    if (url.pathname === "/fapi/v1/klines") {
      if (opts.goldDown && symbol === "XAUUSDT") return json({ msg: "down" }, 503);
      if (url.searchParams.get("interval") === "1d") {
        const D = 24 * H;
        const last = Math.floor(NOW / D) * D - D;
        return json(
          Array.from({ length: 401 }, (_, k) => {
            const t = last - (400 - k) * D;
            const p = 50 * (1 + k * 0.004);
            return [
              t,
              String(p),
              String(p * 1.01),
              String(p * 0.99),
              String(p * 1.002),
              "1",
              t + D - 1,
              "0",
              0,
              "0",
              "0",
              "0",
            ];
          }),
        );
      }
      const start = Number(url.searchParams.get("startTime"));
      const rows = [];
      for (let t = Math.ceil(start / H) * H; t <= LAST && rows.length < 1000; t += H) {
        const i = (t - start) / H;
        const p = 100 * (1 + i * 0.0005);
        rows.push([
          t,
          String(p),
          String(p * 1.003),
          String(p * 0.997),
          String(p * 1.001),
          "100",
          t + H - 1,
          "0",
          0,
          "55",
          "0",
          "0",
        ]);
      }
      return json(rows);
    }
    if (url.pathname === "/fapi/v1/ticker/24hr")
      return json({ symbol, lastPrice: "123.45", priceChangePercent: "-2.50" });
    if (url.pathname === "/fapi/v1/premiumIndex")
      return json({
        symbol,
        markPrice: "123.40",
        lastFundingRate: "0.00045",
        nextFundingTime: NOW + H,
      });
    if (url.pathname === "/fapi/v1/fundingRate")
      return json([{ fundingTime: NOW - 4 * H, fundingRate: "0.0001" }]);
    if (url.pathname === "/futures/data/openInterestHist")
      return json(
        Array.from({ length: 25 }, (_, i) => ({
          sumOpenInterest: String(1000 + i * 4),
          timestamp: NOW - (24 - i) * H,
        })),
      );
    return json({}, 404);
  }) as typeof fetch;
}

function fakeDb(existing: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>([
    ["fear_greed", { value: 72 }],
    ["global", { btcDominance: 57.3 }],
    ...Object.entries(existing),
  ]);
  const db = {
    economicEvent: {
      findMany: async () => [
        {
          title: "CPI m/m",
          currency: "USD",
          impact: "HIGH",
          startsAt: new Date(NOW - 3 * H),
          actual: "0.5%",
          forecast: "0.3%",
          previous: "0.2%",
        },
      ],
      findFirst: async () => ({
        title: "FOMC Statement",
        currency: "USD",
        impact: "HIGH",
        startsAt: new Date(NOW + 2 * H),
        actual: null,
        forecast: null,
        previous: null,
      }),
    },
    ...fakeSnapshotSql(store),
    liquidationMap: {
      findUnique: async () => ({
        data: { clusters: [{ side: "short", price: 160, usd: 5e8 }] },
      }),
    },
  };
  return { db: db as unknown as PrismaClient, store };
}

const model = (enabled: boolean, calls: { n: number }) => ({
  enabled,
  complete: async () => {
    calls.n++;
    return {
      text: "Price sits above its averages while US inflation came in hot.",
      toolInput: null,
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
    };
  },
});

describe("runMarketDesk", () => {
  it("saves a desk per market and keeps going when one market fails", async () => {
    const f = fakeFetch({ goldDown: true });
    const { db, store } = fakeDb();
    const calls = { n: 0 };
    const res = await runMarketDesk({
      db,
      config: { binance: { fetch: f }, bybit: { fetch: f }, okx: { fetch: f } },
      model: model(true, calls),
      now: () => NOW,
    });
    expect(res.failed).toEqual(["XAUUSDT"]);
    expect(res.saved).toContain("BTCUSDT");
    expect(res.summaries).toBe(4);
    const btc = store.get("desk:BTCUSDT") as MarketDeskDto;
    expect(btc.drivers.map((d) => d.key)).toEqual([
      "trend",
      "momentum",
      "positioning",
      "liquidity",
      "macro",
      "mood",
    ]);
    expect(btc.nextEvent?.title).toBe("FOMC Statement");
    // Trend bias on all three timeframes, from closed candles.
    expect(btc.bias?.map((b) => b.timeframe)).toEqual(["1d", "4h", "1h"]);
    expect(btc.bias?.[0]?.state).toBe("up");
    // Price, 24h change and funding come from the live ticker, not the last closed candle.
    expect(btc.price).toBe(123.45);
    expect(btc.change24hPct).toBe(-2.5);
    const pos = btc.drivers.find((d) => d.key === "positioning");
    expect(pos?.evidence.join(" ")).toContain("Funding 0.0450% per settlement (longs crowded");
    expect(btc.drivers.find((d) => d.key === "momentum")?.evidence.join(" ")).toContain(
      "24h move −2.50%",
    );
    expect(btc.drivers.find((d) => d.key === "macro")?.lean).toBe("down");
    expect(btc.summary).toContain("averages");
    // Metals have no crypto mood driver.
    const silver = store.get("desk:XAGUSDT") as MarketDeskDto;
    expect(silver.drivers.some((d) => d.key === "mood")).toBe(false);
  });

  it("keeps a recent summary instead of paying for a new one", async () => {
    const f = fakeFetch();
    const first = fakeDb();
    const calls = { n: 0 };
    const deps = {
      config: { binance: { fetch: f }, bybit: { fetch: f }, okx: { fetch: f } },
      model: model(true, calls),
    };
    await runMarketDesk({ ...deps, db: first.db, now: () => NOW });
    expect(calls.n).toBe(5);
    const again = fakeDb(Object.fromEntries(first.store));
    await runMarketDesk({ ...deps, db: again.db, now: () => NOW + 15 * 60_000 });
    expect(calls.n).toBe(5);
  });

  it("writes no summary when AI is off", async () => {
    const f = fakeFetch();
    const { db, store } = fakeDb();
    await runMarketDesk({
      db,
      config: { binance: { fetch: f }, bybit: { fetch: f }, okx: { fetch: f } },
      model: model(false, { n: 0 }),
      now: () => NOW,
    });
    expect((store.get("desk:ETHUSDT") as MarketDeskDto).summary).toBeNull();
  });
});
