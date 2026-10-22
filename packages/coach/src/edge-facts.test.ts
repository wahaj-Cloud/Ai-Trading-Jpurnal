import { describe, expect, it } from "vitest";
import { edgeFacts } from "./facts.js";
import type { CoachTrade } from "./types.js";

const t = (pnl: number, planned: boolean, btcCorr: number | null): CoachTrade => ({
  id: "x",
  sourceKey: "x",
  symbol: "ETHUSDT",
  direction: "LONG",
  openedAt: new Date(),
  closedAt: new Date(),
  netPnl: String(pnl),
  fees: null,
  entryPrice: null,
  exitPrice: null,
  quantity: null,
  leverage: null,
  holdingSeconds: null,
  settleAsset: "USDT",
  quoteAsset: "USDT",
  journal: null,
  rMultiple: null,
  plannedRewardRisk: null,
  planned,
  btcCorr,
});

describe("edge facts", () => {
  it("compares planned and unplanned only with enough trades", () => {
    const trades = [
      ...Array.from({ length: 16 }, () => t(10, true, 0.9)),
      ...Array.from({ length: 5 }, () => t(-10, false, 0.1)),
    ];
    const text = edgeFacts(trades, true);
    expect(text).toContain("- Planned: 16 trades, win rate 100%, net 160.00");
    expect(text).toContain("- No setup: 5 trades (not enough to compare; needs 15)");
    expect(text).toContain("- Follows BTC: 16 trades");
    expect(text).toContain("- Independent: 5 trades (not enough");
  });
  it("says nothing about setups for traders who never made one", () => {
    expect(edgeFacts([t(1, false, null)], false)).toBe("");
  });
  it("splits trades by the zone they were entered at, once recorded", () => {
    const z = (pnl: number, zone: CoachTrade["zone"]) => ({ ...t(pnl, false, null), zone });
    const trades = [
      ...Array.from({ length: 15 }, () => z(20, "with")),
      ...Array.from({ length: 3 }, () => z(-10, "against")),
      z(5, null),
    ];
    const text = edgeFacts(trades, false);
    expect(text).toContain("BY SUPPLY/DEMAND ZONE AT ENTRY");
    expect(text).toContain("- At a zone, trading with it: 15 trades, win rate 100%, net 300.00");
    expect(text).toContain("- At a zone, trading against it: 3 trades (not enough");
    expect(text).not.toContain("Not at a 1H/4H zone");
    expect(edgeFacts([z(5, null)], false)).toBe("");
  });
});
