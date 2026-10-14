import { describe, expect, it } from "vitest";
import { distToSegment, fibPrices, formatCountdown, rayEnd, TimeAxis } from "./geometry";

describe("TimeAxis", () => {
  const axis = new TimeAxis([1000, 1060, 1120, 1300], 60);
  it("maps candle times to their index and back", () => {
    expect(axis.toLogical(1060)).toBe(1);
    expect(axis.toTime(2)).toBe(1120);
  });
  it("interpolates between candles, including gaps", () => {
    expect(axis.toLogical(1090)).toBe(1.5);
    expect(axis.toLogical(1210)).toBe(2.5);
    expect(axis.toTime(2.5)).toBe(1210);
  });
  it("extrapolates before the first and after the last candle", () => {
    expect(axis.toLogical(880)).toBe(-2);
    expect(axis.toLogical(1420)).toBe(5);
    expect(axis.toTime(5)).toBe(1420);
    expect(axis.toTime(-2)).toBe(880);
  });
});

describe("geometry", () => {
  it("measures distance to a segment", () => {
    expect(distToSegment(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(15, 0, 0, 0, 10, 0)).toBe(5);
  });
  it("extends a ray to the edge", () => {
    expect(rayEnd(0, 50, 10, 50, 200, 100)).toEqual({ x: 200, y: 50 });
    expect(rayEnd(0, 0, 10, 10, 200, 100)).toEqual({ x: 100, y: 100 });
  });
  it("puts Fibonacci 0 at the second point and 1 at the first", () => {
    const f = fibPrices(100, 200);
    expect(f[0]).toEqual({ level: 0, price: 200 });
    expect(f.find((x) => x.level === 0.5)?.price).toBe(150);
    expect(f.at(-1)).toEqual({ level: 1, price: 100 });
  });
});

describe("formatCountdown", () => {
  it("formats every timeframe range", () => {
    expect(formatCountdown(42_000)).toBe("00:42");
    expect(formatCountdown(192_000)).toBe("03:12");
    expect(formatCountdown(3_792_000)).toBe("1:03:12");
    expect(formatCountdown(2 * 86_400_000 + 5 * 3_600_000 + 1)).toBe("2d 05h");
    expect(formatCountdown(-5)).toBe("00:00");
  });
});
