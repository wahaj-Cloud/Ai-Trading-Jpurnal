import { describe, expect, it } from "vitest";
import { marketReaction, parseFigure } from "./reaction";

const ev = (
  title: string,
  currency = "USD",
  forecast: string | null = "0.3%",
  actual: string | null = null,
) => ({
  title,
  currency,
  forecast,
  actual,
});

describe("market reaction", () => {
  it("hot US inflation: USD up, crypto and gold down", () => {
    const r = marketReaction(ev("Core CPI m/m"));
    expect(r.kind).toBe("inflation");
    expect(r.higherLabel).toBe("Above 0.3%");
    expect(r.higher).toEqual([
      { market: "USD", dir: "up" },
      { market: "Crypto (BTC)", dir: "down" },
      { market: "Gold", dir: "down" },
    ]);
    expect(r.lower[1]).toEqual({ market: "Crypto (BTC)", dir: "up" });
  });

  it("treats claims and unemployment as inverse", () => {
    const r = marketReaction(ev("Unemployment Claims", "USD", "227K"));
    expect(r.kind).toBe("unemployment");
    expect(r.higher[0]).toEqual({ market: "USD", dir: "down" });
    expect(r.higher[1]).toEqual({ market: "Crypto (BTC)", dir: "up" });
  });

  it("classifies jobs, rates and speeches; non-USD moves only its currency", () => {
    expect(marketReaction(ev("Non-Farm Employment Change")).kind).toBe("jobs");
    expect(marketReaction(ev("Federal Funds Rate")).kind).toBe("rates");
    const speech = marketReaction(ev("FOMC Member Waller Speaks", "USD", null));
    expect(speech.kind).toBe("speech");
    expect(speech.higherLabel).toMatch(/Hawkish/);
    expect(marketReaction(ev("Employment Change", "AUD")).higher).toEqual([
      { market: "AUD", dir: "up" },
    ]);
  });

  it("reads the outcome once the actual is out", () => {
    expect(marketReaction(ev("CPI y/y", "USD", "2.9%", "3.1%")).outcome).toBe("higher");
    expect(marketReaction(ev("Unemployment Claims", "USD", "227K", "215K")).outcome).toBe("lower");
    expect(marketReaction(ev("CPI y/y", "USD", "2.9%")).outcome).toBeNull();
  });

  it("parses release figures", () => {
    expect(parseFigure("227K")).toBe(227_000);
    expect(parseFigure("-1.2M")).toBe(-1_200_000);
    expect(parseFigure("0.25%")).toBe(0.25);
    expect(parseFigure(null)).toBeNull();
  });
});
