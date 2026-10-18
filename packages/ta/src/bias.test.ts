import { describe, expect, it } from "vitest";
import { biasHistory, closedFourHour, timeframeBias } from "./bias.js";
import type { Candle } from "./indicators.js";

const H = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);
function series(n: number, path: (i: number) => number, step = H): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = path(i) * (1 + Math.sin(i / 3) * 0.004);
    const o = path(Math.max(0, i - 1));
    return { t: T0 + i * step, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 1 };
  });
}

describe("timeframe bias", () => {
  it("steady climb is an up-trend; slide a down-trend; with evidence", () => {
    const up = timeframeBias(
      series(400, (i) => 100 * (1 + i * 0.002)),
      "1h",
    );
    expect(up?.state).toBe("up");
    expect(up?.bars).toBeGreaterThan(10);
    expect(up?.evidence.join(" ")).toContain("above the 50 EMA");
    const down = timeframeBias(
      series(400, (i) => 100 * (1 - i * 0.001)),
      "4h",
    );
    expect(down?.state).toBe("down");
  });

  it("a flat market is a range", () => {
    const flat = timeframeBias(
      series(400, (i) => 100 + Math.sin(i / 2) * 0.5),
      "1d",
    );
    expect(flat?.state).toBe("range");
  });

  it("needs history", () => {
    expect(
      timeframeBias(
        series(30, () => 1),
        "1h",
      ),
    ).toBeNull();
  });

  it("4h candles: only complete UTC blocks, OHLC aggregated", () => {
    const c1 = series(10, (i) => 100 + i); // 00:00..09:00 → blocks 00-04, 04-08 complete; 08-12 not
    const c4 = closedFourHour(c1);
    expect(c4.map((c) => c.t)).toEqual([T0, T0 + 4 * H]);
    expect(c4[0]?.o).toBe(c1[0]?.o);
    expect(c4[0]?.c).toBe(c1[3]?.c);
    expect(c4[0]?.h).toBe(Math.max(...c1.slice(0, 4).map((c) => c.h)));
    expect(c4[0]?.v).toBe(4);
    // History starting mid-block drops that block too.
    const mid = closedFourHour(c1.slice(1));
    expect(mid.map((c) => c.t)).toEqual([T0 + 4 * H]);
  });
});

describe("bias history", () => {
  it("each state equals the bias computed with only the candles up to that point", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let p = 100;
    const path = Array.from({ length: 520 }, (_, i) => {
      p *= 1 + (rnd() - 0.5) * 0.03 + Math.sin(i / 40) * 0.004;
      return p;
    });
    const candles = series(520, (i) => path[i] as number, 4 * H);
    const hist = biasHistory(candles, 4 * H, 250);
    expect(hist).toHaveLength(270);
    const states = new Set(hist.map((h) => h.state));
    expect(states.size).toBeGreaterThan(1);
    for (const i of [250, 251, 300, 377, 450, 519]) {
      const h = hist[i - 250];
      expect(h?.at).toBe((candles[i] as Candle).t + 4 * H);
      expect(h?.state).toBe(timeframeBias(candles.slice(0, i + 1), "4h")?.state);
    }
  });
});
