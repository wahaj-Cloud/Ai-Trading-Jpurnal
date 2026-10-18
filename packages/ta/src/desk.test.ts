import type { DeskEventDto } from "@atc/shared";
import { describe, expect, it } from "vitest";
import {
  buildDesk,
  type DeskCandle,
  type DeskInput,
  liquidityDriver,
  macroDriver,
  toFourHour,
  trendDriver,
} from "./desk.js";

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);

/** 1h candles following `path(i)` with small wiggles so swings form. */
function series(n: number, path: (i: number) => number, taker = 0.5): DeskCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = path(i) + Math.sin(i / 3) * path(i) * 0.004;
    const o = path(Math.max(0, i - 1));
    return {
      t: T0 + i * H,
      o,
      h: Math.max(o, c) * 1.002,
      l: Math.min(o, c) * 0.998,
      c,
      v: 100,
      takerBuyShare: taker,
    };
  });
}

const base = (candles: DeskCandle[], extra: Partial<DeskInput> = {}): DeskInput => ({
  symbol: "BTCUSDT",
  now: (candles.at(-1)?.t ?? T0) + H,
  candles1h: candles,
  fundingRate: null,
  oiChange24hPct: null,
  liqClusters: null,
  recentEvents: [],
  nextEvent: null,
  fearGreed: null,
  btcDominance: null,
  ...extra,
});

const event = (e: Partial<DeskEventDto>): DeskEventDto => ({
  title: "CPI m/m",
  currency: "USD",
  impact: "HIGH",
  startsAt: new Date(T0).toISOString(),
  actual: null,
  forecast: null,
  previous: null,
  ...e,
});

describe("desk drivers", () => {
  it("groups 1h candles into UTC 4h candles", () => {
    const c4 = toFourHour(series(9, (i) => 100 + i));
    expect(c4).toHaveLength(3);
    expect(c4[0]?.t).toBe(T0);
    expect(c4[1]?.v).toBe(400);
  });

  it("trend leans up in a steady climb and down in a slide", () => {
    const up = trendDriver(series(1000, (i) => 50_000 * (1 + i * 0.0006)));
    expect(up?.lean).toBe("up");
    expect(up?.evidence.join(" ")).toContain("above the 4h 200 EMA");
    const down = trendDriver(series(1000, (i) => 80_000 * (1 - i * 0.0004)));
    expect(down?.lean).toBe("down");
  });

  it("liquidity leans toward the bigger nearby cluster", () => {
    const candles = series(50, () => 100);
    const price = candles.at(-1)?.c ?? 100;
    const d = liquidityDriver(
      base(candles, {
        liqClusters: [
          { side: "short", price: price * 1.03, usd: 9e8 },
          { side: "long", price: price * 0.97, usd: 2e8 },
          { side: "long", price: price * 0.5, usd: 9e9 }, // too far away to count
        ],
      }),
    );
    expect(d?.lean).toBe("up");
    expect(d?.evidence[0]).toContain("≈$900M");
  });

  it("macro reads hot US inflation as a headwind for crypto and gold", () => {
    const hot = [event({ actual: "0.5%", forecast: "0.3%" })];
    const btc = macroDriver(
      base(
        series(30, () => 1),
        { recentEvents: hot },
      ),
    );
    expect(btc?.lean).toBe("down");
    expect(btc?.evidence[0]).toContain("weighs on crypto");
    const gold = macroDriver(
      base(
        series(30, () => 1),
        { symbol: "XAUUSDT", recentEvents: hot },
      ),
    );
    expect(gold?.lean).toBe("down");
    expect(gold?.evidence[0]).toContain("metals");
  });

  it("builds a desk with a tally and no mood driver for metals", () => {
    const candles = series(1000, (i) => 2_400 * (1 + i * 0.0003), 0.56);
    const desk = buildDesk(
      base(candles, { symbol: "XAUUSDT", fearGreed: 80, fundingRate: 0.0001, oiChange24hPct: 4 }),
    );
    expect(desk?.name).toBe("Gold");
    expect(desk?.drivers.map((d) => d.key)).toEqual(["trend", "momentum", "positioning"]);
    const t = desk?.leans;
    expect((t?.up ?? 0) + (t?.down ?? 0) + (t?.neutral ?? 0)).toBe(3);
    expect(desk?.drivers.find((d) => d.key === "positioning")?.lean).toBe("up");
    // Never a verdict: no field carries an overall direction or confidence.
    expect(Object.keys(desk ?? {})).not.toContain("verdict");
  });

  it("returns null without candles", () => {
    expect(buildDesk(base([]))).toBeNull();
  });
});
