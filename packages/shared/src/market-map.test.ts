import { describe, expect, it } from "vitest";
import {
  breadthOf,
  flowAgreement,
  futuresBase,
  medianPath,
  moveRank,
  riverPath,
  sectorOf,
  sectorRows,
} from "./market-map.js";

const c = (symbol: string, pct: number, vol = 100) => ({
  symbol,
  priceChangePct: pct,
  volumeUsd: vol,
});

describe("market map", () => {
  it("names sectors, gold and silver included", () => {
    expect(futuresBase("1000PEPEUSDT")).toBe("PEPE");
    expect(futuresBase("1000000MOGUSDT")).toBe("MOG");
    expect(sectorOf("1000PEPEUSDT")).toBe("memes");
    expect(sectorOf("XAUUSDT")).toBe("metals");
    expect(sectorOf("XAGUSDT")).toBe("metals");
    expect(sectorOf("BTCUSDT")).toBe("majors");
    expect(sectorOf("ONDOUSDT")).toBe("rwa");
    expect(sectorOf("NOTUSDT")).toBe("memes");
    expect(sectorOf("ZZZUSDT")).toBe("other");
  });

  it("counts up, down and flat, with the median and the value-weighted move", () => {
    const b = breadthOf([c("A", 2, 300), c("B", -1, 100), c("C", 0.005, 100), c("D", 1, 0)]);
    expect([b.up, b.down, b.flat]).toEqual([2, 1, 1]);
    expect(b.medianPct).toBeCloseTo((0.005 + 1) / 2, 12);
    expect(b.weightedPct).toBeCloseTo((600 - 100 + 0.5) / 500, 12);
    expect(breadthOf([]).medianPct).toBeNull();
  });

  it("ranks sectors by their average move and names the biggest mover", () => {
    const rows = sectorRows([
      c("BTCUSDT", 1),
      c("ETHUSDT", 3),
      c("1000PEPEUSDT", -4),
      c("DOGEUSDT", 2),
      c("XAUUSDT", 0.5),
    ]);
    expect(rows.map((r) => [r.sector, r.count, r.avgPct])).toEqual([
      ["majors", 2, 2],
      ["metals", 1, 0.5],
      ["memes", 2, -1],
    ]);
    expect(rows[2]?.leader).toEqual({ symbol: "1000PEPEUSDT", pct: -4 });
    expect([rows[2]?.up, rows[2]?.down]).toEqual([1, 1]);
  });

  it("river paths end at the live move; the median path aligns at the present", () => {
    expect(riverPath([0, 0.5, 1], 1.2)).toEqual([0, 0.5, 1, 1.2]);
    expect(riverPath([0, 0.5, 1], 1)).toEqual([0, 0.5, 1]);
    expect(
      medianPath([
        [0, 1, 2],
        [0, -1, -2],
        [5, 6],
      ]),
    ).toEqual([0, 1, 2]);
  });

  it("ranks a coin's move and its percentile", () => {
    const coins = [c("A", 3), c("B", -2), c("C", 1), c("D", 0)];
    expect(moveRank(coins, "A")).toEqual({ rank: 1, of: 4, percentile: 100 });
    expect(moveRank(coins, "B")).toEqual({ rank: 4, of: 4, percentile: 0 });
    expect(moveRank(coins, "C")?.percentile).toBeCloseTo(200 / 3, 12);
    expect(moveRank(coins, "X")).toBeNull();
  });

  it("counts timeframes whose flow leans the same way", () => {
    const cell = (p: number) => ({ p, s: "neutral" as const, r: "neutral" as const });
    expect(
      flowAgreement({ "5m": cell(5), "15m": cell(2), "1h": cell(-1), "4h": cell(3) }, "15m"),
    ).toEqual({
      same: 3,
      of: 4,
      side: "buying",
    });
    expect(flowAgreement({ "5m": cell(0) }, "5m")).toEqual({ same: 0, of: 1, side: null });
  });
});
