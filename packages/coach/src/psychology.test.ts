import { describe, expect, it } from "vitest";
import { detectBehaviours } from "./behaviour.js";
import { psychologyFact, psychologyReport } from "./psychology.js";
import type { CoachTrade } from "./types.js";

const DAY = 86_400_000;
const MIN = 60_000;
// Monday 2026-09-28 08:00 UTC; the report runs to Sunday 2026-10-04.
const MON = Date.parse("2026-09-28T08:00:00Z");
let n = 0;
function trade(pnl: string, at: number, extra: Partial<CoachTrade> = {}): CoachTrade {
  n += 1;
  const openedAt = new Date(at);
  return {
    id: `p${String(n).padStart(3, "0")}`,
    sourceKey: `k${n}`,
    symbol: "BTCUSDT",
    direction: "LONG",
    openedAt,
    closedAt: new Date(at + 30 * MIN),
    netPnl: pnl,
    fees: "1",
    entryPrice: "100",
    exitPrice: "101",
    quantity: "10",
    leverage: "10",
    holdingSeconds: 30 * 60,
    settleAsset: "USDT",
    quoteAsset: "USDT",
    journal: null,
    rMultiple: null,
    plannedRewardRisk: null,
    ...extra,
  };
}

const period = {
  timeZone: "UTC",
  from: new Date(Date.parse("2026-09-28T00:00:00Z")),
  to: new Date(Date.parse("2026-10-05T00:00:00Z")),
  fromDay: "2026-09-28",
  toDay: "2026-10-04",
};

function run(trades: CoachTrade[]) {
  const detection = detectBehaviours(trades, {
    timeZone: "UTC",
    from: new Date(MON - 60 * DAY),
    to: period.to,
  });
  return psychologyReport(trades, detection, period);
}

describe("psychology report", () => {
  it("has no score or tax without enough trades", () => {
    const r = run([trade("10", MON), trade("-5", MON + DAY)]);
    expect(r.trades).toBe(2);
    expect(r.score).toBeNull();
    expect(r.parts).toBeNull();
    expect(r.tax).toBeNull();
    expect(r.trend).toHaveLength(8);
    expect(r.trend.at(-1)).toEqual({ week: "2026-09-28", trades: 2, score: null });
    expect(psychologyFact(r)).toBeNull();
  });

  it("a clean week scores 100 and has no tax", () => {
    const trades = [0, 1, 2, 3, 4].map((d) => trade(d % 2 ? "-10" : "15", MON + d * DAY));
    const r = run(trades);
    expect(r.score).toBe(100);
    expect(r.parts).toEqual({ clean: 100, sizing: 100, calmDays: 100 });
    expect(r.tax).toBeNull();
    expect(r.byHabit).toEqual([]);
  });

  it("charges the net of flagged trades once and scores the habits", () => {
    const calm = [0, 1, 2, 3].map((d) => trade("20", MON + d * DAY));
    // Day 5: a loss, then a revenge trade at 3× size five minutes later.
    const loss = trade("-40", MON + 4 * DAY);
    const revenge = trade("-90", MON + 4 * DAY + 35 * MIN, { quantity: "30" });
    const r = run([...calm, loss, revenge]);

    // The revenge trade is flagged twice (revenge + greed) but taxed once.
    expect(r.tax).toEqual({ netPnl: "-90", trades: 1, lossShare: 0.6923 });
    expect(r.byHabit.map((h) => h.code).sort()).toEqual(["GREED", "REVENGE"]);
    expect(r.byHabit.every((h) => h.netPnl === "-90")).toBe(true);
    // clean 5/6, sizing 5/6, calm days 4/5 → 0.5·0.833 + 0.25·0.833 + 0.25·0.8 = 0.825
    expect(r.parts).toEqual({ clean: 83, sizing: 83, calmDays: 80 });
    expect(r.score).toBe(83);
    expect(psychologyFact(r)).toContain("Psychological tax");
  });

  it("re-weights when no trade has a measurable USD size", () => {
    const coin = { settleAsset: "BTC", quoteAsset: "USD" };
    const r = run([0, 1, 2, 3, 4].map((d) => trade("0.001", MON + d * DAY, coin)));
    expect(r.parts?.sizing).toBeNull();
    expect(r.score).toBe(100);
    expect(r.tax).toBeNull();
  });

  it("puts earlier weeks on the trend", () => {
    const old = [0, 1, 2, 3, 4].map((d) => trade("5", MON - 14 * DAY + d * 3600_000));
    const r = run([...old, trade("5", MON)]);
    expect(r.trend.find((w) => w.week === "2026-09-14")).toEqual({
      week: "2026-09-14",
      trades: 5,
      score: 100,
    });
    expect(r.trades).toBe(1);
  });
});

describe("desk summary guard", async () => {
  const { writeDeskSummary } = await import("./desk-summary.js");
  const desk = {
    symbol: "BTCUSDT" as const,
    name: "Bitcoin",
    price: 60_000,
    change24hPct: 1.2,
    computedAt: "2026-10-01T00:00:00.000Z",
    drivers: [
      { key: "trend" as const, lean: "up" as const, headline: "Above averages.", evidence: [] },
    ],
    leans: { up: 1, down: 0, neutral: 0 },
    nextEvent: null,
    recentEvents: [],
  };
  const model = (text: string) => ({
    enabled: true,
    complete: async () => ({ text, toolInput: null, model: "m", inputTokens: 1, outputTokens: 1 }),
  });

  it("keeps a neutral description", async () => {
    expect(await writeDeskSummary(model("Bitcoin sits above its averages."), desk)).toBe(
      "Bitcoin sits above its averages.",
    );
  });

  it("drops anything that reads like a signal", async () => {
    expect(await writeDeskSummary(model("Looks bullish, consider a buy."), desk)).toBeNull();
    expect(await writeDeskSummary(model("Price will rise from here."), desk)).toBeNull();
  });

  it("is skipped when AI is off", async () => {
    expect(await writeDeskSummary({ ...model("x"), enabled: false }, desk)).toBeNull();
  });
});
