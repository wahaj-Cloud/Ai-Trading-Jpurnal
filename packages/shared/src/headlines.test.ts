import { describe, expect, it } from "vitest";
import {
  classifyHeadline,
  headlineSimilarity,
  headlineWords,
  priceReaction,
  SAME_STORY,
} from "./headlines.js";

type Want = [title: string, category: string, impact: string, tag?: string];

// Real market-moving headlines of the last years (as wire services wrote them), and look-alikes.
const CASES: Want[] = [
  ["WHO declares coronavirus outbreak a global pandemic", "world", "HIGH", "pandemic"],
  ["Italy extends coronavirus lockdown to entire country", "world", "HIGH", "pandemic"],
  ["Russia invades Ukraine, explosions heard in Kyiv", "world", "HIGH", "war"],
  ["Iran fires ballistic missiles at Israel", "world", "HIGH", "war"],
  ["Israel launches airstrikes on targets in Iran", "world", "HIGH", "war"],
  [
    "Fed cuts rates to zero in emergency move to fight virus",
    "central-banks",
    "HIGH",
    "rate-decision",
  ],
  ["Fed holds rates steady, signals two cuts this year", "central-banks", "HIGH", "rate-decision"],
  ["ECB raises interest rates by 50 basis points", "central-banks", "HIGH", "rate-decision"],
  [
    "Bank of Japan raises rates for first time in 17 years",
    "central-banks",
    "HIGH",
    "rate-decision",
  ],
  ["Fed slashes rates by half a point", "central-banks", "HIGH", "rate-decision"],
  ["Traders bet Fed will cut rates in December", "central-banks", "MEDIUM", "central-bank"],
  [
    "FOMC statement: Committee decides to maintain target range",
    "central-banks",
    "HIGH",
    "rate-decision",
  ],
  ["Turkey's central bank raises rates to 50%", "central-banks", "MEDIUM", "rate-decision"],
  ["Powell says Fed is in no hurry to lower rates", "central-banks", "MEDIUM", "central-bank"],
  [
    "FTX halts withdrawals as crypto exchange faces liquidity crunch",
    "crypto",
    "HIGH",
    "crypto-shock",
  ],
  [
    "SEC approves spot bitcoin ETFs in watershed moment for crypto",
    "crypto",
    "HIGH",
    "crypto-shock",
  ],
  ["Bybit exchange hacked, $1.5 billion in ether stolen", "crypto", "HIGH", "crypto-shock"],
  ["SEC sues Binance and founder Changpeng Zhao", "crypto", "HIGH", "crypto-shock"],
  ["USDC loses its peg after Silicon Valley Bank exposure", "crypto", "HIGH", "crypto-shock"],
  ["Bitcoin climbs above $70,000 as ETF inflows continue", "crypto", "LOW", "crypto"],
  [
    "Silicon Valley Bank collapses in biggest failure since 2008",
    "world",
    "HIGH",
    "financial-crisis",
  ],
  ["Stocks plunge, circuit breakers triggered at open", "world", "HIGH", "financial-crisis"],
  ["US CPI rises 0.4%, hotter than expected", "economy", "HIGH", "data-shock"],
  ["Payrolls surge by 336,000 in September", "economy", "HIGH", "data-shock"],
  ["US jobless claims edge lower", "economy", "MEDIUM", "data"],
  ["Recession fears grow as yield curve inverts", "economy", "MEDIUM", "data"],
  [
    "Trump announces 25% tariffs on imports from Mexico and Canada",
    "world",
    "MEDIUM",
    "trade-sanctions",
  ],
  ["EU agrees new sanctions package against Russia", "world", "MEDIUM", "trade-sanctions"],
  ["US government shutdown begins as funding lapses", "world", "MEDIUM", "trade-sanctions"],
  ["Ceasefire talks resume in Cairo", "world", "MEDIUM", "geopolitics"],
  ["OPEC+ agrees surprise output cut", "world", "MEDIUM", "geopolitics"],
  ["Military coup in Niger as soldiers seize power", "world", "HIGH", "terror"],
  // Look-alikes that must stay quiet.
  ["Price war heats up among Chinese EV makers", "markets", "LOW"],
  ["Trade war worries weigh on chipmakers", "world", "MEDIUM", "trade-sanctions"],
  ["Star Wars franchise lifts Disney earnings", "markets", "LOW"],
  ["Missile maker Lockheed Martin beats earnings estimates", "markets", "LOW"],
  ["Airlines report record profits in post-covid travel boom", "markets", "LOW"],
  ["Bank cuts mortgage rates for first-time buyers", "markets", "LOW"],
  ["Apple unveils new iPhone at September event", "markets", "LOW"],
];

describe("headline rules", () => {
  it.each(CASES)("%s → %s / %s", (title, category, impact, tag) => {
    const c = classifyHeadline({ title });
    expect({ category: c.category, impact: c.impact }).toEqual({ category, impact });
    if (tag) expect(c.tags).toContain(tag);
    if (impact === "LOW") expect(c.why).toBeNull();
    else expect(c.why).toBeTruthy();
  });

  it("official central-bank releases go to Central banks; a policy release is always High", () => {
    const fed = classifyHeadline({
      title: "Federal Reserve issues FOMC statement",
      source: "FED",
      monetaryPolicy: true,
    });
    expect(fed).toMatchObject({ category: "central-banks", impact: "HIGH" });
    const speech = classifyHeadline({
      title: "Christine Lagarde: A new age of capital",
      source: "ECB",
    });
    expect(speech).toMatchObject({ category: "central-banks", impact: "MEDIUM" });
  });

  it("a provider's importance can raise the rating but never lower it", () => {
    expect(classifyHeadline({ title: "Markets steady ahead of data", importance: 3 }).impact).toBe(
      "HIGH",
    );
    expect(classifyHeadline({ title: "Russia invades Ukraine", importance: 1 }).impact).toBe(
      "HIGH",
    );
  });

  it("keeps a crypto-section story in Crypto unless something bigger is going on", () => {
    expect(
      classifyHeadline({ title: "Analysts eye next resistance level", sourceCategory: "crypto" })
        .category,
    ).toBe("crypto");
    expect(
      classifyHeadline({
        title: "Russia invades Ukraine; bitcoin slides",
        sourceCategory: "crypto",
      }).category,
    ).toBe("world");
  });

  it("the summary helps place a story but never makes it High", () => {
    const c = classifyHeadline({
      title: "Markets brace for a volatile week",
      summary: "Investors weigh the war in the Middle East and the Fed decision.",
    });
    expect(c.impact).toBe("LOW");
    expect(c.category).not.toBe("markets");
  });
});

describe("same story from several sources", () => {
  it("matches rewordings and keeps different stories apart", () => {
    const a = headlineWords("Fed cuts rates by 50 basis points in surprise move");
    const b = headlineWords("Federal Reserve cuts rates by 50 basis points, a surprise move");
    const c = headlineWords("ECB holds rates steady as inflation cools");
    expect(headlineSimilarity(a, b)).toBeGreaterThanOrEqual(SAME_STORY);
    expect(headlineSimilarity(a, c)).toBeLessThan(SAME_STORY);
    expect(headlineSimilarity(new Set(), a)).toBe(0);
  });
});

describe("market reaction", () => {
  it("measures from the publication minute's open to the close N minutes later", () => {
    const t0 = Date.UTC(2026, 9, 18, 12, 30);
    const candles = Array.from({ length: 70 }, (_, i) => ({
      t: t0 + i * 60_000,
      o: 100 - i * 0.1,
      c: 100 - (i + 1) * 0.1,
    }));
    const pub = t0 + 25_000; // 12:30:25
    // Open of 12:30 is 100; close of 12:45 candle (i = 15) is 100 − 1.6 = 98.4.
    expect(priceReaction(candles, pub, 15 * 60_000)).toBeCloseTo(-1.6, 10);
    expect(priceReaction(candles, pub, 60 * 60_000)).toBeCloseTo(-6.1, 10);
    expect(priceReaction(candles, pub, 90 * 60_000)).toBeNull();
  });
});
