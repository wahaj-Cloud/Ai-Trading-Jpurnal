import { describe, expect, it } from "vitest";
import { setupMarkets } from "./scan.js";

const listings = [
  { symbol: "FETUSDT", quoteVolume: 5 },
  { symbol: "TAOUSDT", quoteVolume: 9 },
  { symbol: "DOGEUSDT", quoteVolume: 100 },
  ...Array.from({ length: 40 }, (_, i) => ({ symbol: `X${i}USDT`, quoteVolume: i })),
];

describe("coins a setup watches", () => {
  it("its own coins plus each sector's most traded coins", () => {
    expect(
      setupMarkets({ symbols: ["BTCUSDT", "TAOUSDT"], sectors: ["ai"], paperBots: [] }, listings),
    ).toEqual(["BTCUSDT", "TAOUSDT", "FETUSDT"]);
  });
  it("ignores names that are not sectors, and has nothing without listings", () => {
    expect(
      setupMarkets({ symbols: [], sectors: ["other", "nope"], paperBots: [] }, listings),
    ).toEqual([]);
    expect(setupMarkets({ symbols: [], sectors: ["ai"], paperBots: [] }, [])).toEqual([]);
  });
  it("keeps a bot's sector coin even outside the most traded", () => {
    const quiet = setupMarkets(
      {
        symbols: [],
        sectors: ["ai"],
        paperBots: [{ symbol: "GRASSUSDT" }, { symbol: "DOGEUSDT" }],
      },
      listings,
    );
    expect(quiet).toEqual(["TAOUSDT", "FETUSDT", "GRASSUSDT"]);
  });
});
