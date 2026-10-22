import { orderBlocks } from "@atc/ta/structure";
import { describe, expect, it } from "vitest";
import { chartZones, sdChartZones, tfLabel } from "./zones";

const M = 60_000;
const k = (i: number, o: number, h: number, l: number, c: number) => ({
  t: i * M,
  o,
  h,
  l,
  c,
  v: 1,
});

describe("chartZones", () => {
  it("keeps unfilled gaps and drops filled or tiny ones", () => {
    const c = [
      k(0, 100, 101, 99, 100.5),
      k(1, 100.5, 104, 100.5, 103.8), // bullish gap 101 → 102 (candle 0 high below candle 2 low)
      k(2, 103.8, 105, 102, 104.5),
      k(3, 104.5, 106, 103, 105.5), // stays above 102: gap unfilled
      k(4, 105.5, 105.6, 104.9, 105.5),
      k(5, 105.5, 105.56, 105.45, 105.5),
      k(6, 105.5, 105.6, 105.41, 105.55), // tiny gap 105.56 → 105.6? none; flat
    ];
    const z = chartZones(c, { fvg: true, ob: false });
    expect(z).toEqual([
      { kind: "FVG", bullish: true, top: 102, bottom: 101, from: 60, touched: false },
    ]);
    // Price trades back into the gap: it is gone.
    const filled = [...c, k(7, 105.5, 105.5, 101.5, 102)];
    expect(chartZones(filled, { fvg: true, ob: false })).toEqual([]);
    expect(chartZones(c, { fvg: false, ob: false })).toEqual([]);
  });
});

function walk(n: number, seed: number) {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p *= 1 + (rand() - 0.5) * 0.02;
    out.push({
      t: i * 900_000,
      o,
      h: Math.max(o, p) * (1 + rand() * 0.004),
      l: Math.min(o, p) * (1 - rand() * 0.004),
      c: p,
      v: 1,
    });
  }
  return out;
}

describe("live chart zones", () => {
  it("draws breaker blocks that are still in play (they used to be filtered out every time)", () => {
    let breakers = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const cs = walk(500, seed);
      const zones = chartZones(cs, { fvg: false, ob: true });
      const shown = zones.filter((z) => z.kind === "BRK");
      breakers += shown.length;
      // Every breaker shown has had no close back through its far side since it broke.
      const all = orderBlocks(cs).filter((z) => z.kind === "BREAKER");
      for (const z of shown) {
        const src = all.find((x) => Math.floor(x.t / 1000) === z.from && x.top === z.top);
        expect(src).toBeDefined();
        const after = cs.slice((src?.brokenIndex as number) + 1);
        expect(
          z.bullish ? after.every((x) => x.c >= z.bottom) : after.every((x) => x.c <= z.top),
        ).toBe(true);
      }
    }
    expect(breakers).toBeGreaterThan(0);
  });
});

describe("supply and demand on the chart", () => {
  // Quiet market around 100, a base, a rally to 103.5, a pause and a drop back to 101.
  const c: ReturnType<typeof k>[] = [];
  let n = 0;
  const add = (o: number, c2: number, h: number, l: number) => c.push(k(n++, o, h, l, c2));
  for (let x = 0; x < 20; x++) add(100, 100.2, 100.5, 99.5);
  add(100, 100.1, 100.4, 99.6);
  add(100.1, 100, 100.3, 99.7);
  add(100, 101.8, 101.9, 99.95);
  add(101.8, 103.5, 103.6, 101.7);
  for (let x = 0; x < 6; x++) add(103.5, 103.6, 103.8, 103.3);
  add(103.5, 101, 103.6, 100.9);

  it("labels each zone with its side, timeframe and whether price came back", () => {
    const z = sdChartZones(c, 101, "4h");
    expect(z).toEqual([
      {
        kind: "SUP",
        bullish: false,
        top: 103.8,
        bottom: 103.5,
        from: 26 * 60,
        touched: false,
        label: "Supply · 4H · fresh",
      },
      {
        kind: "DEM",
        bullish: true,
        top: 100.2,
        bottom: 99.5,
        from: 18 * 60,
        touched: false,
        label: "Demand · 4H · fresh",
      },
    ]);
    expect(tfLabel("15m")).toBe("15m");
    expect(tfLabel("1d")).toBe("1D");
  });
});
