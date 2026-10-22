import { describe, expect, it } from "vitest";
import { atr, type Candle } from "./indicators.js";
import {
  nearestZones,
  SD_LEG_ATR,
  SD_MAX_HEIGHT_ATR,
  supplyDemandZones,
  zoneTapAt,
} from "./supply-demand.js";

const T0 = Date.UTC(2026, 9, 20);
const M5 = 300_000;
let i = 0;
const k = (o: number, c: number, h: number, l: number): Candle => ({
  t: T0 + i++ * M5,
  o,
  c,
  h,
  l,
  v: 1,
});
const flat = (p: number) => k(p, p + 0.2, p + 0.5, p - 0.5);

/**
 * 20 quiet candles around 100 (ATR ≈ 1), a quiet base, a 2-candle rally to 103.5, a pause, a
 * 1-candle drop back to 101, then price comes back into the demand box twice.
 */
function market(): Candle[] {
  i = 0;
  const c: Candle[] = [];
  for (let n = 0; n < 20; n++) c.push(flat(100));
  c.push(k(100, 100.1, 100.4, 99.6), k(100.1, 100, 100.3, 99.7)); // base
  c.push(k(100, 101.8, 101.9, 99.95), k(101.8, 103.5, 103.6, 101.7)); // rally
  for (let n = 0; n < 6; n++) c.push(k(103.5, 103.6, 103.8, 103.3)); // pause (supply base)
  c.push(k(103.5, 101, 103.6, 100.9)); // drop
  c.push(k(101, 100.5, 101.1, 100.1)); // into demand: test 1
  c.push(k(100.5, 101.5, 101.6, 100.4)); // out
  c.push(k(101.5, 100.8, 101.6, 100.0)); // in again: test 2
  return c;
}

describe("supply and demand zones", () => {
  it("finds the demand base under the rally and the supply base over the drop", () => {
    const z = supplyDemandZones(market());
    const demand = z.find((x) => x.side === "demand");
    const supply = z.find((x) => x.side === "supply");
    // Base: the last 4 quiet candles before the rally (two flat ones and the two base candles).
    expect(demand).toMatchObject({ proximal: 100.2, distal: 99.5, top: 100.2, bottom: 99.5 });
    expect(demand?.baseIndex).toBe(18);
    expect(demand?.t).toBe(T0 + 18 * M5);
    expect(demand?.legEnd).toBe(23);
    expect(demand?.tests).toBe(2);
    expect(demand?.departureAtr).toBeGreaterThanOrEqual(SD_LEG_ATR);
    // Supply: the pause before the drop; nothing came back up into it.
    expect(supply).toMatchObject({ proximal: 103.5, distal: 103.8, tests: 0 });
    expect(supply?.baseIndex).toBe(26);
  });

  it("drops a zone once a candle closes beyond its far edge", () => {
    const c = market();
    c.push(k(100.8, 99.2, 100.9, 99.1)); // closes below 99.5
    expect(supplyDemandZones(c).some((x) => x.side === "demand")).toBe(false);
    // A wick through without a close keeps it.
    const w = market();
    w.push(k(100.8, 100.1, 100.9, 99.0));
    expect(supplyDemandZones(w).some((x) => x.side === "demand")).toBe(true);
  });

  it("needs a strong departure: a slow drift makes no zone", () => {
    i = 0;
    const c: Candle[] = [];
    for (let n = 0; n < 20; n++) c.push(flat(100));
    // Ten small up candles: 3 points in total, never 2 ATR within 3 candles.
    for (let n = 0; n < 10; n++)
      c.push(k(100 + n * 0.3, 100.3 + n * 0.3, 100.5 + n * 0.3, 99.9 + n * 0.3));
    expect(supplyDemandZones(c)).toEqual([]);
  });

  it("the nearest zones: supply above the price, demand below, closest first", () => {
    const z = supplyDemandZones(market());
    const near = nearestZones(z, 101);
    expect(near.map((x) => x.side)).toEqual(["supply", "demand"]);
    // Inside a zone counts as nearest on its side.
    expect(nearestZones(z, 99.8).map((x) => x.side)).toEqual(["supply", "demand"]);
    expect(nearestZones(z, 104).map((x) => x.side)).toEqual(["demand"]);
  });

  it("on random markets every zone obeys the rules", () => {
    let s = 7;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let run = 0; run < 40; run++) {
      i = 0;
      const c: Candle[] = [];
      let p = 100;
      for (let n = 0; n < 600; n++) {
        const o = p;
        const burst = rnd() < 0.05 ? (rnd() - 0.5) * 6 : 0;
        p = o + (rnd() - 0.5) * 1.2 + burst;
        c.push(k(o, p, Math.max(o, p) + rnd() * 0.5, Math.min(o, p) - rnd() * 0.5));
      }
      const a = atr(c, 14);
      const zones = supplyDemandZones(c);
      for (const z of zones) {
        expect(z.top).toBeGreaterThan(z.bottom);
        const ref = a[z.legStart - 1] as number;
        expect(z.top - z.bottom).toBeLessThanOrEqual(SD_MAX_HEIGHT_ATR * ref + 1e-9);
        // The leg: 1-3 candles covering at least 2 ATR from the first one's open.
        expect(z.legEnd - z.legStart).toBeLessThan(3);
        const first = c[z.legStart] as Candle;
        const last = c[z.legEnd] as Candle;
        const dir = z.side === "demand" ? 1 : -1;
        expect(dir * (last.c - first.o)).toBeGreaterThanOrEqual(SD_LEG_ATR * ref - 1e-9);
        // The edges come from the base candles.
        const base = c.slice(z.baseIndex, z.legStart);
        expect(base.length).toBeGreaterThan(0);
        expect(base.length).toBeLessThanOrEqual(4);
        const distal =
          dir === 1 ? Math.min(...base.map((x) => x.l)) : Math.max(...base.map((x) => x.h));
        expect(z.distal).toBe(distal);
        expect(z.departureAtr).toBeGreaterThanOrEqual(SD_LEG_ATR);
        // Never broken after it formed.
        for (const x of c.slice(z.legEnd + 1))
          expect(z.side === "demand" ? x.c >= z.distal : x.c <= z.distal).toBe(true);
      }
      // No overlapping zones on the same side.
      for (const x of zones)
        for (const y of zones)
          if (x !== y && x.side === y.side) expect(x.bottom > y.top || x.top < y.bottom).toBe(true);
    }
  });
});

describe("tapping a zone (setup condition)", () => {
  const c = market();
  it("the first return into the demand box is a fresh tap; the second is not fresh", () => {
    // Candle 31 is the first back into the demand box; 33 the second.
    expect(zoneTapAt(c.slice(0, 32), "demand", true)).toMatchObject({ proximal: 100.2, tests: 0 });
    expect(zoneTapAt(c.slice(0, 34), "demand", true)).toBeNull();
    expect(zoneTapAt(c.slice(0, 34), "demand", false)).toMatchObject({ tests: 1 });
    // Candle 32 is out of the box: no tap.
    expect(zoneTapAt(c.slice(0, 33), "demand", false)).toBeNull();
    expect(zoneTapAt(c.slice(0, 32), "supply", false)).toBeNull();
  });

  it("a candle that closes through the box is a break, not a tap", () => {
    const d = c.slice(0, 31);
    d.push(k(101, 99.2, 101.1, 99.1));
    expect(zoneTapAt(d, "demand", false)).toBeNull();
  });
});
