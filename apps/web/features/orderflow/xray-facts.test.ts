import { sessionVwap } from "@atc/ta/indicators";
import { describe, expect, it } from "vitest";
import { boxDist, xrayFacts } from "./xray-facts";

const M15 = 900_000;
const DAY = 86_400_000;
const D0 = Date.UTC(2026, 9, 21);

/** Yesterday flat around 100; today a base at 100, a rally to ~104, then drifting at 103. */
function candles() {
  const out = [];
  let t = D0;
  for (let i = 0; i < 96; i++, t += M15)
    out.push({ t, o: 100, h: 100.6, l: 99.4, c: 100.1, v: 10 });
  for (let i = 0; i < 20; i++, t += M15)
    out.push({ t, o: 100, h: 100.5, l: 99.5, c: 100.2, v: 10 });
  out.push({ t, o: 100.2, h: 101.9, l: 100.1, c: 101.8, v: 30 });
  t += M15;
  out.push({ t, o: 101.8, h: 103.6, l: 101.7, c: 103.5, v: 30 });
  t += M15;
  for (let i = 0; i < 10; i++, t += M15)
    out.push({ t, o: 103.4, h: 103.7, l: 103.1, c: 103.3, v: 10 });
  return out;
}

describe("coin card facts", () => {
  it("today's VWAP and range, yesterday's range", () => {
    const c = candles();
    const f = xrayFacts(c, { "1h": [], "4h": [] }, 103.3);
    expect(f.vwap).toBe(sessionVwap(c).at(-1));
    expect(f.vwapDistPct).toBeCloseTo((103.3 / (f.vwap as number) - 1) * 100, 12);
    expect(f.dayHigh).toBe(103.7);
    expect(f.dayLow).toBe(99.5);
    expect(f.prevHigh).toBe(100.6);
    expect(f.prevLow).toBe(99.4);
    expect(f.supply).toBeNull();
    expect(f.demand).toBeNull();
  });

  it("nearest demand below from the zone timeframes, with its distance", () => {
    // The same candles as 1H stand-ins: the base before the rally is a demand zone.
    const c = candles().map((x, i) => ({ ...x, t: D0 - 200 * DAY + i * 3_600_000 }));
    const f = xrayFacts(candles(), { "1h": c, "4h": [] }, 103.3);
    expect(f.demand?.label).toBe("1H demand zone");
    expect(f.demand?.top).toBeLessThan(103.3);
    expect(f.demand?.distPct).toBeCloseTo(
      boxDist(103.3, f.demand?.bottom ?? 0, f.demand?.top ?? 0),
      12,
    );
    expect(f.demand?.fresh).toBe(true);
  });

  it("distance to a box: + above, − below, 0 inside", () => {
    expect(boxDist(100, 101, 102)).toBeCloseTo(1, 12);
    expect(boxDist(100, 98, 99)).toBeCloseTo(-1, 12);
    expect(boxDist(100, 99, 101)).toBe(0);
  });
});
